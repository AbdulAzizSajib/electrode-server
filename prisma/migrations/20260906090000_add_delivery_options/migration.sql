-- Delivery options replace shipping rules: the order records which option the
-- shopper chose. See openspec/changes/replace-shipping-rules-with-delivery-options.
--
-- PURELY ADDITIVE, and deliberately so. One enum and three nullable columns on
-- Order. Nothing is altered, nothing is dropped, and there is no backfill in
-- this step. ShippingRule, ShippingPlace and Product.shippingRuleId all remain
-- exactly as they are.
--
-- That separation is the point (design.md, D7). A backfill script reads the
-- existing ShippingPlace rows and derives the option list into
-- StoreSetting.checkoutConfig; only once that has run and a merchant has
-- checked the result against their old rules does a SECOND migration drop the
-- source tables. A single migration that both derived data and dropped its
-- source could be neither inspected in between nor rolled back afterwards.
--
-- All three columns are nullable, for two populations that legitimately have
-- none rather than as a convenience:
--   - orders placed before delivery options existed, which have no choice to
--     record and must not be invented one;
--   - landing-page orders, which are priced by the page's own deliveryZones and
--     never consult the shop's option list at all.
-- There is consequently no DEFAULT: a default would assert a delivery method
-- for orders whose method is genuinely unknown.
--
-- Why a key AND a label, when shippingAmount already captures the price:
-- deliveryOptionKey is the stable handle that survives a rename, so grouping
-- orders by option keeps working after the merchant edits the list;
-- deliveryOptionLabel is captured at placement and never updated, because it is
-- what the shopper agreed to and must not move when the option is renamed,
-- repriced or deleted. Same split, same reasoning, as landingPageId /
-- landingPageTitle on this table.
--
-- No index on deliveryOptionKey. Grouping orders by delivery option is an
-- occasional report over a table already indexed on createdAt and status, not a
-- hot lookup, and the column's cardinality is a handful of values.
-- Safe to deploy ahead of the admin and storefront work: nothing reads these
-- columns until the checkout starts writing them.

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('DELIVERY', 'PICKUP');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryMethod" "DeliveryMethod",
ADD COLUMN     "deliveryOptionKey" TEXT,
ADD COLUMN     "deliveryOptionLabel" TEXT;
