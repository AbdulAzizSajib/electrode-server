import app from "./app";
import { envVars } from "./config/env";
import { isStorefrontRevalidationConfigured } from "./utils/revalidateStorefront";
import { seedSuperAdmin } from "./utils/seed";

const bootstrap = async () => {
    try {
        await seedSuperAdmin();
        app.listen(envVars.PORT, () => {
            console.log(`Server is running on http://localhost:${envVars.PORT}`);

            /*
             * Stated POSITIVELY at boot, because `revalidateStorefront` only
             * ever says something when it is broken, and then only once. An
             * operator asking "why does the storefront lag behind my saves?"
             * needs to distinguish "configured, so this is a real bug" from
             * "never configured" — and silence answers neither.
             *
             * Here rather than in `app.ts` so it runs once per boot, not once
             * per serverless invocation. `api.ts` has no listen and so never
             * reaches this line; that path is covered by the warn-once inside
             * `revalidateStorefront`, which fires on the first attempt.
             */
            console.log(
                isStorefrontRevalidationConfigured()
                    ? "Storefront revalidation: configured"
                    : "Storefront revalidation: NOT configured — admin saves will " +
                          "take up to each resource's revalidate window to appear.",
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error);
    }
};

bootstrap();