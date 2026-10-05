
-- CreateIndex
CREATE INDEX `Campaign_status_startsAt_endsAt_idx` ON `Campaign`(`status`, `startsAt`, `endsAt`);

-- CreateIndex
CREATE INDEX `ProductImage_productId_isPrimary_idx` ON `ProductImage`(`productId`, `isPrimary`);

-- CreateIndex
CREATE INDEX `ProductImage_productId_sortOrder_idx` ON `ProductImage`(`productId`, `sortOrder`);

-- CreateIndex
CREATE INDEX `Review_productId_status_idx` ON `Review`(`productId`, `status`);

-- CreateIndex
CREATE INDEX `Product_status_createdAt_idx` ON `Product`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `Product_status_totalSold_idx` ON `Product`(`status`, `totalSold`);

-- CreateIndex
CREATE INDEX `Product_status_offerPrice_idx` ON `Product`(`status`, `offerPrice`);

-- CreateIndex
CREATE INDEX `Product_status_isFeatured_createdAt_idx` ON `Product`(`status`, `isFeatured`, `createdAt`);

-- CreateIndex
CREATE INDEX `Product_status_categoryId_idx` ON `Product`(`status`, `categoryId`);

-- CreateIndex
CREATE INDEX `Product_status_brandId_idx` ON `Product`(`status`, `brandId`);

-- DropIndex (after its replacements exist: every new Product index leads with `status`)
DROP INDEX `Product_status_idx` ON `Product`;
