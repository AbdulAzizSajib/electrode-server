/**
 * Body of `POST /products/:id/views`.
 *
 * `source` is the marker distinguishing "a shopper opened this product's page"
 * from any other call. It is required and checked server-side: a client-side
 * check would be advisory only, and the whole point is that listings, previews
 * and prefetches must not count.
 * See add-product-view-tracking design.md Decision 3.
 */
export interface IRecordProductViewPayload {
    source: "product_detail";
}
