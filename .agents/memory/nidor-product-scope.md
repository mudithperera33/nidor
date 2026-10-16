---
name: NIDOR product scope
description: Durable product and storefront constraints for future NIDOR changes.
---

The user authorizes replacing NIDOR's repetitive homepage with a simple homepage and database-backed shop. The Fragrance Worlds page should present all five approved experiences sequentially as one scroll journey, not as clickable tiles. Keep their product information, scenes, animation choreography, and order presentation unchanged. Support full bottles as a distinct variant from 5 ml and 10 ml decants; volume, price, stock, active state, and SKU are managed per variant. Use the actual bottle volume; never assume 100 ml, price, stock, or availability. Unknown prices remain unset, unknown stock remains zero/unconfigured, and removal stays reversible through deactivation.

**Why:** The user explicitly requested a continuous scroll through the five worlds, preservation of their cinematic presentation, and full-bottle sales without invented catalog data.

**How to apply:** Treat the homepage and catalog structure as changeable when requested; render the existing world experiences in catalogue order on the Worlds page without tiles, and preserve their visual scenes and interactions. Model bottles separately from decants, use admin-supplied volume and commercial data, and preserve admin security and database policies.

Order and inventory handling stays in NIDOR's own database. Payment gateway integration is separate and will be added later; orders are fulfilled physically by the business.

**Why:** The user explicitly confirmed the business-owned order, payment, and fulfillment model.

**How to apply:** Keep order records and stock reservations in the app database. Do not route checkout through a third-party store or imply that payment has been collected until a payment integration is added.