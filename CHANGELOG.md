# Changelog

## [1.1.0](https://github.com/fabkho/libellus/compare/v1.0.0...v1.1.0) (2026-10-07)


### Features

* **db:** add reading pages and Book cards for sharing with friends ([624e2ea](https://github.com/fabkho/libellus/commit/624e2ea82c9875404d1fac8b4c0044ce634b6d45))
* **db:** authors, works and series beside the Catalogue, with her corrections ([9e492d9](https://github.com/fabkho/libellus/commit/9e492d9d8a124d5c567cfe12cbca56121793c57b))
* **db:** one canonical genre list, computed genres and the member's own ([3747fb4](https://github.com/fabkho/libellus/commit/3747fb46da9a62640e023b9a09373b40eb514eae))
* **db:** queue Catalogue Books for enrichment and store what is found ([72e2ff9](https://github.com/fabkho/libellus/commit/72e2ff94b77ada22274bd408d1f5aabbed888887))
* filter and sort the Library and say how each book was read ([b3093ad](https://github.com/fabkho/libellus/commit/b3093ad477477424a388c36ccc4e19b2d91f1c86)), closes [#169](https://github.com/fabkho/libellus/issues/169)
* filter and sort the Library, and Read as on each book ([9aaed8f](https://github.com/fabkho/libellus/commit/9aaed8f1e32a711d3099e4022e5d0b411c388e0c))
* **functions:** the enrich edge function for authors, series and genres ([9f963bb](https://github.com/fabkho/libellus/commit/9f963bbc79ac73a613ac236822393008da48dc77))
* **og:** draw the link-preview images of a reading page ([63235e5](https://github.com/fabkho/libellus/commit/63235e5033ced9228534cd1e4c4b12d8efd970fc))
* **web:** add sharing settings and Share on a Book's options ([9840ec2](https://github.com/fabkho/libellus/commit/9840ec24b7db97ee12a9d1aa914016cf766dfcba))
* **web:** add the public reading page and Book cards ([e36fdde](https://github.com/fabkho/libellus/commit/e36fdde4fdfcb766ba33417aab93251b2cc025ef))
* **web:** add the reading page repository ([1ac645e](https://github.com/fabkho/libellus/commit/1ac645ebc585d3a16bdca75fc43abf75b27ad107))
* **web:** answer a shared reading page's link with its preview ([73119e8](https://github.com/fabkho/libellus/commit/73119e84424d112a77e6ef3b9fbe4d0304fb5d6f))
* **web:** data-layer repositories for authors, series and genres ([610a35c](https://github.com/fabkho/libellus/commit/610a35c36365bc402e51d3fb64bd86768e9fcb59))
* **web:** move Not finished into the Library filters so the bar stays one row ([04663e7](https://github.com/fabkho/libellus/commit/04663e77b6fcf3746c73328f0d57b527c20287e2)), closes [#169](https://github.com/fabkho/libellus/issues/169)
* **web:** open /r/* to everyone and leave it to the network ([211f8a9](https://github.com/fabkho/libellus/commit/211f8a9f7133b5664a328253c30f94610be334c2))
* What's new after an update, and the version on the Profile ([711e066](https://github.com/fabkho/libellus/commit/711e0665ff9e462cb305b9d7d43e68446be7add8))


### Fixes

* **db:** let one drain finish before the next is called ([e576feb](https://github.com/fabkho/libellus/commit/e576febc9bb4dd5614c772c748dbf51119ae968d))
* **enrich:** accept a work only when its title is the Book's ([d608a7e](https://github.com/fabkho/libellus/commit/d608a7e2b971eea5d99042bdff3d87ec14a52526))
* **enrich:** keep publishers' series and sub-genres out of series and genres ([fc02e54](https://github.com/fabkho/libellus/commit/fc02e54a0ffbaa444940777e858919ed28a7c4ad))
* **enrich:** link a Book to the author page that exists, not a second one by name ([0647fb0](https://github.com/fabkho/libellus/commit/0647fb001cbb9e2d9b2a28c8cf49e18f2a030319))
* **functions:** name a Wikidata series that has no label in the app's languages ([d9a1e86](https://github.com/fabkho/libellus/commit/d9a1e86dce142719bc505e051685043d31441e60))
* **og:** keep titles literal, ship the font licences and the full headers ([12ceb55](https://github.com/fabkho/libellus/commit/12ceb556cdfd55ef3b9ace3f4ea18aba3ca75f54))
* **share:** 404 for a reading-page address that leads nowhere ([ca3705c](https://github.com/fabkho/libellus/commit/ca3705cda5a3b48d80ec4dc06f17822ed27390b4))
* **share:** answer 404 for a reading-page address that leads nowhere ([280d9d1](https://github.com/fabkho/libellus/commit/280d9d105e910b4053265ef0c93545d4dc6417aa))
* **web:** keep Clear all in the Filter sheet in place and fade it in ([6978b75](https://github.com/fabkho/libellus/commit/6978b7578b1445b01035060eed4e5e3b679dd114)), closes [#169](https://github.com/fabkho/libellus/issues/169)
* **web:** treat a view without a Status choice as none ([2a48b16](https://github.com/fabkho/libellus/commit/2a48b16deda856587003c99359877523420de228)), closes [#169](https://github.com/fabkho/libellus/issues/169)

## 1.0.0 (2026-10-07)

The first versioned release: Libellus as it was on `main` when releases began
([101d996](https://github.com/fabkho/libellus/commit/101d9968d6403b4713ac6d38e4cce883cc04ae8f)).
What came before is in the git history and the closed pull requests. From here on,
release-please writes this file from the conventional commits merged into `main`
(docs/OPERATIONS.md, "Releases").
