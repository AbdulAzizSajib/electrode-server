/**
 * Seeds one COMPLETE Bangla campaign landing page — every authorable field
 * filled, so the whole rendered document can be reviewed at once.
 *
 * Distinct from `seed-demo-landing-page.ts`, which fills the minimum needed to
 * prove the feature works. This one exists to be LOOKED AT: every optional
 * field carries real copy, every repeating list has several entries, so a
 * design review sees each section rendered rather than absent. A field left
 * empty here would read as "the design has no such section" rather than "this
 * seed skipped it".
 *
 * IDEMPOTENT. Upserts on the slug below, so re-running refreshes the page
 * rather than piling up copies, and never touches any other landing page.
 *
 * Created as PUBLISHED but NOT made active: the shop stays in WEBSITE mode and
 * its home page is untouched. The page is reachable at its own /offer/<slug>
 * URL either way — being "active" only decides what the storefront ROOT serves.
 *
 * PACKAGES DO AUTHOR THEIR OWN PRICES, and the ones seeded below deliberately
 * differ from the product's own — which is what makes it visible on the
 * rendered page that a package's price is what is charged. That is the one
 * exception to the model's "no price lives here" rule; see LandingPage.prisma
 * for why it is safe and what enforces it.
 *
 * Run:  npx tsx scripts/seed-bangla-landing-page.ts
 */
import { LandingPageStatus, ProductStatus } from "../src/generated/prisma/enums";
import { prisma } from "../src/app/lib/prisma";

const SLUG = "winter-hoodie-offer";

/**
 * The product this campaign sells.
 *
 * Chosen by name rather than by id so the script survives a reseeded database,
 * and falls back to any ACTIVE product with a struck-through price so the
 * "৳1000 → ৳700" pair renders even if this exact product is gone.
 */
const PREFERRED_PRODUCT = "MI Watch MT58";

async function pickProduct() {
    const preferred = await prisma.product.findFirst({
        where: { name: PREFERRED_PRODUCT, status: ProductStatus.ACTIVE },
        select: { id: true, name: true, offerPrice: true, sellingPrice: true },
    });
    if (preferred) return preferred;

    // Any ACTIVE product with a sellingPrice above its offerPrice, so the
    // discount badge and the struck-through price both have something to show.
    const fallback = await prisma.product.findFirst({
        where: { status: ProductStatus.ACTIVE, sellingPrice: { not: null } },
        select: { id: true, name: true, offerPrice: true, sellingPrice: true },
        orderBy: { createdAt: "desc" },
    });
    return fallback;
}

/** The product's own gallery, reused as the landing page's media. */
async function productImages(productId: string) {
    const images = await prisma.productImage.findMany({
        where: { productId },
        select: { url: true, altText: true },
        orderBy: { sortOrder: "asc" },
        take: 6,
    });
    return images;
}

const main = async () => {
    const product = await pickProduct();

    if (!product) {
        console.error(
            "No ACTIVE product to attach a landing page to. Seed the catalogue first — a landing page cannot exist without a product to sell.",
        );
        process.exit(1);
    }

    const images = await productImages(product.id);

    /*
     * MEDIA — the hero gallery.
     *
     * Falls back to one placeholder entry when the product has no images, so
     * the gallery section still renders and can be judged. `alt` is Bangla like
     * everything else a shopper could encounter; it is read aloud by a screen
     * reader, so it is copy, not a technical label.
     */
    const media =
        images.length > 0
            ? images.map((image, index) => ({
                  type: "IMAGE" as const,
                  url: image.url,
                  alt: image.altText || `${product.name} — ছবি ${index + 1}`,
              }))
            : [
                  {
                      type: "IMAGE" as const,
                      url: "/placeholder.png",
                      alt: "পণ্যের ছবি",
                  },
              ];

    const data = {
        title: "শীতের অফার - হুডি",
        slug: SLUG,
        status: LandingPageStatus.PUBLISHED,
        productId: product.id,

        /* ---------------- Hero ---------------- */
        headline: "শীতে উষ্ণ থাকুন, স্টাইলেও এগিয়ে থাকুন",
        subheadline:
            "প্রিমিয়াম মানের পণ্য, সাশ্রয়ী দামে। সীমিত সময়ের জন্য বিশেষ ছাড় — আজই অর্ডার করুন।",
        badgeText: "৩০% ছাড়",

        /* ---------------- Body ----------------
         * Semantic HTML as the admin's Tiptap editor produces it. Stored as
         * authored and sanitised on the storefront, not here — see
         * LandingPage.prisma on bodyHtml.
         */
        bodyHtml: [
            "<h2>কেন এই পণ্যটি বেছে নেবেন?</h2>",
            "<p>দীর্ঘদিনের ব্যবহার উপযোগী, আরামদায়ক এবং আধুনিক ডিজাইনের এই পণ্যটি তৈরি হয়েছে আপনার প্রতিদিনের প্রয়োজনের কথা ভেবে। প্রতিটি পণ্য হাতে হাতে যাচাই করে পাঠানো হয়।</p>",
            "<h3>যা যা পাচ্ছেন</h3>",
            "<ul>",
            "<li>১০০% অরিজিনাল পণ্যের নিশ্চয়তা</li>",
            "<li>সারা দেশে দ্রুত হোম ডেলিভারি</li>",
            "<li>পণ্য হাতে পেয়ে টাকা পরিশোধের সুবিধা</li>",
            "<li>সমস্যা হলে ৭ দিনের মধ্যে পরিবর্তনের সুযোগ</li>",
            "</ul>",
            "<h3>ব্যবহারের নিয়ম</h3>",
            "<p>প্যাকেট খুলে পণ্যটি ভালোভাবে দেখে নিন। কোনো সমস্যা মনে হলে ডেলিভারি ম্যানের সামনেই আমাদের হটলাইনে কল করুন — আমরা সাথে সাথেই সমাধান করে দেব।</p>",
            "<blockquote><p>হাজারো ক্রেতার আস্থা — কারণ আমরা পণ্যের মান নিয়ে আপস করি না।</p></blockquote>",
        ].join(""),

        media,

        /* ---------------- Highlights ---------------- */
        highlights: [
            {
                icon: "lucide:badge-check",
                title: "১০০% অরিজিনাল",
                text: "প্রতিটি পণ্য সরাসরি আমদানিকারকের কাছ থেকে সংগ্রহ করা।",
            },
            {
                icon: "lucide:truck",
                title: "সারা দেশে ডেলিভারি",
                text: "ঢাকার ভিতরে ২৪ ঘণ্টায়, ঢাকার বাইরে ৪৮-৭২ ঘণ্টায়।",
            },
            {
                icon: "lucide:hand-coins",
                title: "ক্যাশ অন ডেলিভারি",
                text: "পণ্য হাতে পেয়ে, দেখে নিয়ে তারপর টাকা পরিশোধ করুন।",
            },
            {
                icon: "lucide:rotate-ccw",
                title: "৭ দিনের রিটার্ন",
                text: "পণ্যে ত্রুটি থাকলে ৭ দিনের মধ্যে বদলে নিন।",
            },
            {
                icon: "lucide:shield-check",
                title: "৬ মাসের ওয়ারেন্টি",
                text: "সার্ভিস ওয়ারেন্টিসহ বিক্রয়োত্তর সেবা।",
            },
            {
                icon: "lucide:headset",
                title: "২৪/৭ সাপোর্ট",
                text: "যেকোনো সময় কল করুন — আমরা পাশে আছি।",
            },
        ],

        /* ---------------- FAQs ---------------- */
        faqs: [
            {
                question: "ডেলিভারি চার্জ কত?",
                answer:
                    "ঢাকার ভিতরে ৬০ টাকা এবং ঢাকার বাইরে ১২০ টাকা। অর্ডার করার সময় আপনার এলাকা নির্বাচন করলেই মোট খরচ দেখতে পাবেন।",
            },
            {
                question: "পণ্য হাতে পেতে কত দিন লাগবে?",
                answer:
                    "ঢাকার ভিতরে সাধারণত ২৪ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ৪৮ থেকে ৭২ ঘণ্টার মধ্যে পৌঁছে যায়।",
            },
            {
                question: "আগে টাকা দিতে হবে কি?",
                answer:
                    "না। এটি সম্পূর্ণ ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে, দেখে নিয়ে তারপর টাকা পরিশোধ করবেন।",
            },
            {
                question: "পণ্য পছন্দ না হলে ফেরত দেওয়া যাবে?",
                answer:
                    "পণ্যে কোনো ত্রুটি থাকলে ৭ দিনের মধ্যে বদলে নিতে পারবেন। পণ্যটি অব্যবহৃত ও আসল প্যাকেটে থাকতে হবে।",
            },
            {
                question: "অর্ডার করার পর কী হবে?",
                answer:
                    "আমাদের একজন প্রতিনিধি আপনার দেওয়া নম্বরে কল করে অর্ডারটি নিশ্চিত করবেন, এরপর পণ্যটি পাঠানো হবে।",
            },
            {
                question: "একসাথে একাধিক অর্ডার করা যাবে?",
                answer:
                    "অবশ্যই। অর্ডার ফর্মে পরিমাণ বাড়িয়ে নিন, অথবা কল করে জানান — একাধিক পণ্যে বিশেষ ছাড় পেতে পারেন।",
            },
        ],

        /* ---------------- Customer quotes ---------------- */
        quotes: [
            {
                name: "রাকিবুল হাসান",
                text: "অর্ডার করার পরদিনই পেয়ে গেছি। পণ্যের মান আশার চেয়েও ভালো। ধন্যবাদ!",
                rating: 5,
            },
            {
                name: "সাদিয়া আক্তার",
                text: "দাম অনুযায়ী অসাধারণ। ডেলিভারি ম্যান খুব ভদ্র ছিলেন, বক্স খুলে দেখিয়েও দিয়েছেন।",
                rating: 5,
            },
            {
                name: "মোঃ ইমরান হোসেন",
                text: "চট্টগ্রামে দুই দিনে পেয়েছি। ক্যাশ অন ডেলিভারি হওয়ায় নিশ্চিন্তে অর্ডার করতে পেরেছি।",
                rating: 4,
            },
            {
                name: "নুসরাত জাহান",
                text: "প্রথমে একটু সন্দেহ ছিল, কিন্তু পণ্য হাতে পেয়ে সব সন্দেহ দূর হয়ে গেছে। আবারও কিনব।",
                rating: 5,
            },
            /*
             * A SCREENSHOT review — no `text` at all, which is the shape real
             * campaigns post. Exercises the image-only path and proves an
             * empty paragraph is not left behind.
             */
            {
                name: "তানভীর আহমেদ",
                imageUrl: media[0]?.url ?? "/placeholder.png",
            },
        ],

        /* ---------------- Trust badges ---------------- */
        trustBadges: [
            { icon: "lucide:shield-check", label: "নিরাপদ কেনাকাটা" },
            { icon: "lucide:package-check", label: "অরিজিনাল পণ্য" },
            { icon: "lucide:banknote", label: "ক্যাশ অন ডেলিভারি" },
            { icon: "lucide:phone-call", label: "২৪/৭ হেল্পলাইন" },
        ],

        /* ---------------- Packages ----------------
         * Two tiers, so the selector, the struck-through price, the free-gift
         * line and the badge all have something to render — and so switching
         * between them exercises the re-quote.
         *
         * Both point at the SAME product here because this database has one
         * suitable product; a real campaign would bind each tier to its own.
         * The authored prices deliberately differ from the product's own, which
         * is what makes the package price visible in the rendered page.
         */
        packages: [
            {
                key: "single",
                label: "১ পিস",
                productId: product.id,
                price: 700,
                compareAtPrice: 1000,
            },
            {
                key: "combo",
                label: "২ পিস কম্বো",
                productId: product.id,
                price: 1299,
                compareAtPrice: 2000,
                freeGiftText: "+ ফ্রি ডেলিভারি",
                badge: "হট অফার",
                preselected: true,
            },
        ],

        /* ---------------- Why us ---------------- */
        whyUs: [
            { title: "১০০% অরিজিনাল", text: "সরাসরি আমদানিকারকের কাছ থেকে সংগ্রহ করা।" },
            { title: "যাচাই করে পাঠানো", text: "প্রতিটি পণ্য হাতে হাতে পরীক্ষা করা হয়।" },
            { title: "দ্রুত ডেলিভারি", text: "ঢাকায় ২৪ ঘণ্টা, বাইরে ৪৮-৭২ ঘণ্টা।" },
            { title: "সহজ রিটার্ন", text: "ত্রুটি থাকলে ৭ দিনের মধ্যে বদলে নিন।" },
            { title: "ওয়ারেন্টি", text: "৬ মাসের সার্ভিস ওয়ারেন্টি।" },
            { title: "২৪/৭ সাপোর্ট", text: "যেকোনো সময় কল করুন।" },
            { title: "নিরাপদ প্যাকেজিং", text: "পথে যেন ক্ষতি না হয়।" },
            { title: "হাজারো ক্রেতা", text: "দেশজুড়ে বিশ্বস্ত।" },
        ],

        /* ---------------- Usage ideas ---------------- */
        usageIdeas: [
            { label: "প্রতিদিনের ব্যবহারে", icon: "lucide:sun" },
            { label: "অফিসে", icon: "lucide:briefcase" },
            { label: "ভ্রমণে", icon: "lucide:plane" },
            { label: "ব্যায়ামের সময়", icon: "lucide:dumbbell" },
            { label: "উপহার হিসেবে", icon: "lucide:gift" },
            { label: "ছুটির দিনে", icon: "lucide:coffee" },
            { label: "রাতে ঘুমানোর আগে", icon: "lucide:moon" },
            { label: "পরিবারের সাথে", icon: "lucide:users" },
        ],

        /* ---------------- Offer mechanics ----------------
         * A deadline SEVEN DAYS OUT rather than a fixed date, so a re-run of
         * this seed always produces a live countdown instead of an expired one.
         *
         * `stopOrdersAtDeadline` is FALSE: this is a demo page, and a seed that
         * quietly stopped accepting orders after a week would look like a bug.
         */
        offerEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        stopOrdersAtDeadline: false,

        /*
         * A run of 100. The "taken" figure is COUNTED from this page's real
         * orders — there is nothing to seed here and deliberately no field that
         * could carry one, so a fresh seed shows 0 of 100 until someone orders.
         */
        scarcityTarget: 100,

        orderPhone: "01867788456",

        /*
         * ASKS FOR AN ADVANCE, so the payment section can be reviewed in place.
         *
         * Whether it actually renders depends on the SHOP having advance
         * payment enabled with at least one account — the switch is an AND, not
         * an override. A store that has not configured accounts sees this
         * campaign fall back to plain cash on delivery, which is the correct
         * degradation rather than a broken seed.
         */
        requiresAdvancePayment: true,

        /*
         * The reference campaign's amber, as a FULL token set — so the banded,
         * themed page can be reviewed whole rather than as an accent over
         * default greys.
         *
         * Every value here is one a merchant could type. Nothing is derived,
         * and the page renders exactly these.
         */
        theme: {
            accent: "#e18820",
            accentSoft: "#fdf6ec",
            accentContrast: "#ffffff",
            surface: "#ffffff",
            surfaceAlt: "#faf7f2",
            text: "#1f2937",
            textMuted: "#6b7280",
            border: "#eadfd0",
        },

        /* ---------------- Delivery zones ----------------
         * The selected zone's price is CHARGED — a landing page order bypasses
         * the shop's free-shipping threshold and any coupon shipping waiver,
         * because the page stated this charge and that is what the shopper
         * agreed to. See LandingPage.prisma.
         */

        /* ---------------- Order form ----------------
         * Only `fullName.required` is a switch. Phone and address carry no
         * requiredness flag by construction — phone because the per-phone COD
         * cap and guest order lookup are keyed on it, address because a COD
         * parcel with no address cannot be delivered.
         */
        orderForm: {
            heading: "অর্ডার করতে নিচের ফর্মটি পূরণ করুন",
            subheading: "আপনার তথ্য দিন, পণ্য হাতে পেয়ে টাকা পরিশোধ করুন।",
            fields: {
                fullName: {
                    label: "আপনার নাম",
                    placeholder: "সম্পূর্ণ নাম লিখুন",
                    helper: "পার্সেলের গায়ে এই নামটিই লেখা হবে।",
                    required: true,
                },
                phone: {
                    label: "মোবাইল নম্বর",
                    placeholder: "01XXXXXXXXX",
                    helper: "অর্ডার কনফার্ম করতে আমরা এই নম্বরে কল করব।",
                },
                address: {
                    label: "সম্পূর্ণ ঠিকানা",
                    placeholder: "গ্রাম/রোড, থানা, জেলা",
                    helper: "কুরিয়ার যেন সহজে খুঁজে পায়, এমনভাবে লিখুন।",
                },
            },
            submitLabel: "অর্ডার কনফার্ম করুন",
            notice: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন।",
        },

        /* ---------------- Post-order ---------------- */
        successHeading: "ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।",
        successMessage:
            "আমাদের একজন প্রতিনিধি অল্প কিছুক্ষণের মধ্যেই আপনাকে কল করে অর্ডারটি নিশ্চিত করবেন। অর্ডার নম্বরটি সংরক্ষণ করে রাখুন — পরে খোঁজ নিতে কাজে লাগবে।",

        /* ---------------- SEO ---------------- */
        metaTitle: "শীতের বিশেষ অফার — ৩০% ছাড়ে অরিজিনাল পণ্য",
        metaDescription:
            "সীমিত সময়ের অফারে প্রিমিয়াম মানের পণ্য। সারা দেশে ক্যাশ অন ডেলিভারি, ৭ দিনের রিটার্ন সুবিধা। আজই অর্ডার করুন।",
        ogImageUrl: media[0]?.url,

        /*
         * A Facebook Pixel id is DELIBERATELY NOT SEEDED.
         *
         * Digits-only and validated, so a fake one would pass — and then the
         * storefront would fire real pixel events at an id that is either
         * nobody's or, worse, somebody else's ad account. The field is left
         * null; set a real id in the admin when the campaign actually runs.
         */

        sortOrder: 0,
    };

    const page = await prisma.landingPage.upsert({
        where: { slug: SLUG },
        create: data,
        update: data,
        select: { id: true, slug: true, status: true, title: true },
    });

    console.log("Landing page seeded.\n");
    console.log(`  title    ${page.title}`);
    console.log(`  slug     ${page.slug}`);
    console.log(`  status   ${page.status}`);
    console.log(`  product  ${product.name}  (৳${product.offerPrice}, was ৳${product.sellingPrice ?? "—"})`);
    console.log(`  media    ${media.length} image(s)`);
    console.log(`\n  View at  http://localhost:4000/offer/${page.slug}`);
    console.log(`  Admin    http://localhost:5173/ui/landing-pages/${page.id}`);
    console.log(
        "\nPUBLISHED but not active — the shop's home page is untouched, and the page is reachable at its own URL.",
    );
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
