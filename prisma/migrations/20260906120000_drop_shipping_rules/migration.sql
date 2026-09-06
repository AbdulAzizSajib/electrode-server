-- Drop the shipping-rule model, now that delivery options have replaced it.
-- See openspec/changes/replace-shipping-rules-with-delivery-options, design.md D7.
--
-- DESTRUCTIVE, and the second half of a deliberately two-step migration. The
-- first step (20260906090000_add_delivery_options) only added; then
-- scripts/backfill-delivery-options.ts derived the option list from these very
-- rows into StoreSetting.checkoutConfig.delivery and the result was checked
-- against the old rules in Checkout Settings. Only after that does this run.
--
-- Splitting it that way is what made the derivation inspectable: a single
-- migration that both read these tables and dropped them could not be examined
-- in between, and could not be re-run if the mapping turned out wrong.
--
-- ROLLBACK IS NO LONGER A REVERT. Until this migration, the old tables were
-- intact and the previous release could simply be redeployed. From here,
-- recovering the rules means restoring from backup. That is the cost of this
-- step and the reason it was held back until the data had been carried across
-- and verified.
--
-- No order is affected. Order.shippingAmount has always been the CAPTURED
-- amount charged, and nothing on Order ever referenced a rule or a place — so
-- these drops orphan nothing and no historical total changes. Orders placed
-- through the new checkout carry their choice in deliveryMethod /
-- deliveryOptionKey / deliveryOptionLabel, added in the first step.
--
-- Product.shippingRuleId goes with them. Delivery stopped being a property of a
-- product: one store-wide list serves the whole shop, so there is nothing left
-- for the column to point at. Its FK was onDelete: Restrict, which is why the
-- constraint is dropped before the table it referenced.
--
-- ShippingPlace is dropped before ShippingRule because it holds the FK into it;
-- its own cascade would have handled the rows, but the explicit order keeps
-- this readable as the dependency chain it is.

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_shippingRuleId_fkey";

-- DropForeignKey
ALTER TABLE "ShippingPlace" DROP CONSTRAINT "ShippingPlace_shippingRuleId_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "shippingRuleId";

-- DropTable
DROP TABLE "ShippingPlace";

-- DropTable
DROP TABLE "ShippingRule";
