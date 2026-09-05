/**
 * Seeds one demo campaign landing page, so the feature can be seen working
 * against real data without authoring a page by hand first.
 *
 * IDEMPOTENT. Upserts on the slug `demo-campaign`, so re-running refreshes the
 * demo rather than piling up copies — and never touches any other landing page.
 *
 * It picks the product itself rather than taking an id, choosing the one that
 * demonstrates the most: ACTIVE, in stock, and preferring a product with a
 * `compareAtPrice` (so the struck-through "regular price" and the discount badge
 * both render) and with images (so the gallery has something to show). A landing
 * page cannot author a price, so what the page displays IS whatever that product
 * is priced at — see LandingPage.prisma.
 *
 * Created as PUBLISHED but NOT made active: the shop stays in WEBSITE mode and
 * its home page is untouched. Flip the toggle on the admin's Landing Pages
 * screen when you actually want it live. Seeding a page that silently replaced
 * the merchant's home page would be a surprise, not a demo.
 *
 * Run:  npx tsx scripts/seed-demo-landing-page.ts
 */
import { LandingPageStatus, ProductStatus } from "../src/generated/prisma/enums";
import { prisma } from "../src/app/lib/prisma";
import {
    DEFAULT_DELIVERY_ZONES,
    DEFAULT_ORDER_FORM,
} from "../src/app/module/landing-page/landing-page.constant";

const SLUG = "demo-campaign";

/**
 * The best product to demonstrate with, or null when the catalogue has none.
 *
 * "Best" here means: ACTIVE, and with stock actually available — the same
 * `quantity - reservedQuantity` sum the checkout reads, so the demo page is
 * orderable rather than showing "out of stock" the moment it opens. Among
 * those, one with a compare-at price wins, because it exercises the price
 * display fully.
 */
async function pickProduct() {
    const candidates = await prisma.product.findMany({
        where: { status: ProductStatus.ACTIVE },
        select: {
            id: true,
            name: true,
            price: true,
            compareAtPrice: true,
            _count: { select: { images: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    if (candidates.length === 0) return null;

    const stock = await prisma.stock.groupBy({
        by: ["productId"],
        where: { productId: { in: candidates.map((product) => product.id) } },
        _sum: { quantity: true, reservedQuantity: true },
    });

    const availableById = new Map(
        stock.map((row) => [
            row.productId,
            (row._sum.quantity ?? 0) - (row._sum.reservedQuantity ?? 0),
        ]),
    );

    const inStock = candidates.filter((product) => (availableById.get(product.id) ?? 0) > 0);

    // Falls back to any ACTIVE product when nothing has stock — a demo page that
    // says "out of stock" still demonstrates that state correctly, and is far
    // more useful than the script refusing to run.
    const pool = inStock.length > 0 ? inStock : candidates;

    const withCompareAt = pool.filter((product) => product.compareAtPrice !== null);
    const preferred = withCompareAt.length > 0 ? withCompareAt : pool;

    // Most images first, so the gallery has something to show.
    preferred.sort((a, b) => b._count.images - a._count.images);

    return {
        ...preferred[0],
        available: availableById.get(preferred[0].id) ?? 0,
    };
}

const DEMO_CONTENT = {
    headline: "সীমিত সময়ের অফার — আজই অর্ডার করুন",
    subheadline: "সারা দেশে ক্যাশ অন ডেলিভারি। পণ্য হাতে পেয়ে টাকা পরিশোধ করুন।",
    badgeText: "বিশেষ ছাড়",
    bodyHtml:
        "<p>এটি একটি <strong>ডেমো ক্যাম্পেইন পেজ</strong>। অ্যাডমিন প্যানেলের " +
        "<em>UI → Landing Pages</em> থেকে এই পেজের প্রতিটি লেখা, ছবি, ভিডিও, " +
        "ডেলিভারি চার্জ এবং অর্ডার ফর্ম আপনি নিজের মতো বদলাতে পারবেন।</p>" +
        "<ul><li>একটি পণ্য, একটি পেজ, একটি অর্ডার ফর্ম</li>" +
        "<li>কার্ট বা লগইন ছাড়াই সরাসরি অর্ডার</li>" +
        "<li>ঢাকার ভিতরে ও বাইরে আলাদা ডেলিভারি চার্জ</li></ul>",
    highlights: [
        { icon: "mdi:truck-fast", title: "সারা দেশে ডেলিভারি", text: "২-৪ দিনের মধ্যে পৌঁছে যাবে" },
        { icon: "mdi:cash", title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে টাকা দিন" },
        { icon: "mdi:shield-check", title: "১০০% অরিজিনাল", text: "নকল হলে টাকা ফেরত" },
        { icon: "mdi:phone-in-talk", title: "সরাসরি সাপোর্ট", text: "অর্ডারের পর আমরা কল করব" },
    ],
    faqs: [
        {
            question: "ডেলিভারি চার্জ কত?",
            answer: "ঢাকার ভিতরে ৳৬০ এবং ঢাকার বাইরে ৳১২০। অর্ডার ফর্মে এলাকা নির্বাচন করলেই মোট টাকা দেখতে পাবেন।",
        },
        {
            question: "টাকা কখন দিতে হবে?",
            answer: "পণ্য হাতে পাওয়ার পর ডেলিভারিম্যানকে দিয়ে দিন। আগে কোনো টাকা লাগবে না।",
        },
        {
            question: "অর্ডার করার পর কী হবে?",
            answer: "আমাদের প্রতিনিধি আপনার দেওয়া নম্বরে কল করে অর্ডারটি কনফার্ম করবেন।",
        },
        {
            question: "পণ্য পছন্দ না হলে?",
            answer: "ডেলিভারির সময় পণ্য দেখে নিতে পারবেন। সমস্যা থাকলে আমাদের জানান।",
        },
    ],
    quotes: [
        { name: "রহিম আহমেদ", text: "মঙ্গলবার অর্ডার করেছিলাম, বৃহস্পতিবার সকালেই পেয়ে গেছি। প্যাকেজিং খুব ভালো ছিল।", rating: 5 },
        { name: "সাদিয়া ইসলাম", text: "দাম অনুযায়ী মান অসাধারণ। ভাই কল করে অর্ডার কনফার্ম করেছিলেন, খুব ভালো লেগেছে।", rating: 5 },
        { name: "করিম উদ্দিন", text: "ঢাকার বাইরে থেকে অর্ডার করেছি, ৩ দিনে পেয়েছি। ক্যাশ অন ডেলিভারি বলে নিশ্চিন্তে অর্ডার করা যায়।", rating: 4 },
    ],
    trustBadges: [
        { icon: "mdi:shield-check", label: "১০০% অরিজিনাল পণ্য" },
        { icon: "mdi:truck-check", label: "দ্রুত ডেলিভারি" },
        { icon: "mdi:cash-refund", label: "ক্যাশ অন ডেলিভারি" },
    ],
    successHeading: "ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।",
    successMessage:
        "আমাদের প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন। অর্ডার নম্বরটি সংরক্ষণ করে রাখুন।",
    metaTitle: "সীমিত সময়ের অফার — ডেমো ক্যাম্পেইন",
    metaDescription:
        "ক্যাশ অন ডেলিভারিতে সারা দেশে ডেলিভারি। কার্ট বা লগইন ছাড়াই সরাসরি অর্ডার করুন।",
};

async function main() {
    const product = await pickProduct();

    if (!product) {
        console.error(
            "No ACTIVE product found — a landing page must sell something. " +
                "Publish a product first, then run this again.",
        );
        process.exit(1);
    }

    console.log(`Product:   ${product.name}`);
    console.log(`Price:     ${product.price}${product.compareAtPrice ? ` (was ${product.compareAtPrice})` : ""}`);
    console.log(`Available: ${product.available}\n`);

    const content = {
        productId: product.id,
        status: LandingPageStatus.PUBLISHED,
        headline: DEMO_CONTENT.headline,
        subheadline: DEMO_CONTENT.subheadline,
        badgeText: DEMO_CONTENT.badgeText,
        bodyHtml: DEMO_CONTENT.bodyHtml,
        /*
         * No `media`, deliberately. The storefront falls back to the bound
         * product's own images when a page has no campaign media of its own, so
         * the demo shows real photography rather than placeholders — and shows
         * that fallback working.
         */
        media: [],
        highlights: DEMO_CONTENT.highlights,
        faqs: DEMO_CONTENT.faqs,
        quotes: DEMO_CONTENT.quotes,
        trustBadges: DEMO_CONTENT.trustBadges,
        // The same Bangla defaults a page created in the admin panel starts with.
        deliveryZones: DEFAULT_DELIVERY_ZONES,
        orderForm: DEFAULT_ORDER_FORM,
        successHeading: DEMO_CONTENT.successHeading,
        successMessage: DEMO_CONTENT.successMessage,
        metaTitle: DEMO_CONTENT.metaTitle,
        metaDescription: DEMO_CONTENT.metaDescription,
        // No pixel: a demo must not report page views and purchases into
        // somebody's real ad account.
        facebookPixelId: null,
        sortOrder: 0,
    };

    const landingPage = await prisma.landingPage.upsert({
        where: { slug: SLUG },
        create: {
            title: "ডেমো ক্যাম্পেইন",
            slug: SLUG,
            ...content,
        },
        // `title` and `slug` are left alone on update, so a merchant who renamed
        // the demo keeps their name.
        update: content,
    });

    console.log(`Landing page ready: ${landingPage.title}`);
    console.log(`   Storefront:  /lp/${landingPage.slug}`);
    console.log(`   Admin:       /ui/landing-pages/${landingPage.id}`);
    console.log(`   Status:      ${landingPage.status}\n`);

    const setting = await prisma.storeSetting.findFirst({
        select: { siteMode: true, activeLandingPageId: true },
    });

    console.log(`Site mode is ${setting?.siteMode ?? "WEBSITE"} — your home page is unchanged.`);
    if (setting?.activeLandingPageId !== landingPage.id) {
        console.log(
            "To serve this page at your home page instead, open the admin's " +
                "Landing Pages screen and turn on landing page mode.",
        );
    }

    await prisma.$disconnect();
}

void main();
