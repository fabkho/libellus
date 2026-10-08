# Changelog

## [1.4.0](https://github.com/fabkho/libellus/compare/v1.3.0...v1.4.0) (2026-10-08)


### Features

* **data:** add a Book optimistically through the outbox ([9b15b88](https://github.com/fabkho/libellus/commit/9b15b88784d57c572f2e1a8f68468f04443a8b3c))
* **db:** started_series, the series she has started and not finished ([9b4e81a](https://github.com/fabkho/libellus/commit/9b4e81a01c429e0463ea1608f7e525d0c7d6e163))
* **edition:** changing edition presets Read as from the new edition's format ([61bf2a6](https://github.com/fabkho/libellus/commit/61bf2a665f467cb81c7fca03af8450c6a17551be))
* **edition:** the editions move in as the sources answer ([e7b3111](https://github.com/fabkho/libellus/commit/e7b3111e61e2bf926bfe3ccc96bc8ea968b2c358))
* **edition:** the editions move in, the format row says what it does, Read as follows the edition ([a5d35d1](https://github.com/fabkho/libellus/commit/a5d35d161ef43ce4cf2378130190205186a484db))
* **edition:** the format row says what it does and goes along with the change ([80509b5](https://github.com/fabkho/libellus/commit/80509b54e8b02015bd9b004af8312d7eae6d7b3f))
* **home:** the data layer for the series she has started ([d81cfc4](https://github.com/fabkho/libellus/commit/d81cfc42e062f1964d8f03c939d094108d01bdfc))
* **home:** the series she has started, five at a time, with a See more sheet ([674e7d1](https://github.com/fabkho/libellus/commit/674e7d1a39d7be66defd6e543fda253c608a86a7))
* **home:** the series she has started, five at a time, with a See more sheet ([dd38584](https://github.com/fabkho/libellus/commit/dd38584c833924718d3c26e6f77e2e8b9e028dc7))
* **profile:** open the books read on a day from the Reading days ([b61ef57](https://github.com/fabkho/libellus/commit/b61ef57b22bde45c807ca907fa6b6ea88c3b3878))
* **profile:** open the books read on a day from the Reading days ([c416ec5](https://github.com/fabkho/libellus/commit/c416ec586ff47fbb7598b55933fa27b035c1991a))
* **profile:** open the books without a page count from the Pages card ([c32fc89](https://github.com/fabkho/libellus/commit/c32fc8910e62a2fcec16a7e2a2c5bedc89994c5d))
* **profile:** open the books without a page count from the Pages card ([3845e95](https://github.com/fabkho/libellus/commit/3845e959ec3548d6da54d3944c738b954695f7e2))
* **search:** make adding from the palette optimistic ([203fada](https://github.com/fabkho/libellus/commit/203fada485c7300ba7b1cffec214c05caa986010))
* **search:** make the palette's add optimistic ([399add6](https://github.com/fabkho/libellus/commit/399add6773acfc7ba1919201606a787a7baeec0a))
* **stats:** name the reads each reading day was read in ([25eb798](https://github.com/fabkho/libellus/commit/25eb79864888e7694d355ec19e059ffb6281b58b))
* **stats:** read the books without a page count ([2e15d1d](https://github.com/fabkho/libellus/commit/2e15d1db78e993ecee074b48442b4d10ef06282f))


### Fixes

* **db:** give the change-edition read-as migration its own version ([1e0492b](https://github.com/fabkho/libellus/commit/1e0492bc12ee79a202b49347e161fcaab3215cf3))
* **db:** give the change-edition read-as migration its own version ([7a4c552](https://github.com/fabkho/libellus/commit/7a4c552d08695c7424474340dcc2bde66616143e))

## [1.3.0](https://github.com/fabkho/libellus/compare/v1.2.0...v1.3.0) (2026-10-08)


### Features

* **email:** a mail an edge function sends can be generated from the shell ([0a509c6](https://github.com/fabkho/libellus/commit/0a509c665014e055ddd0941db789ddab49201e41))
* **email:** design the sign-in code mail in the app's look ([ea99e78](https://github.com/fabkho/libellus/commit/ea99e7822cd735a66c8e05ee3050b4ad2d4778b7))
* **email:** generate the sign-in mail from the design tokens ([4047185](https://github.com/fabkho/libellus/commit/404718569ef03f1bddf01da6dd09cd34d98eaab1))
* **email:** preview the mail light and dark with Playwright ([3b8073e](https://github.com/fabkho/libellus/commit/3b8073e311e2a4aefcf65c368e91049ac1ba2396))
* **waitlist:** an Invite button on the owner's Waitlist ([2a0bc4a](https://github.com/fabkho/libellus/commit/2a0bc4a0daba6c6329bef904445e6c18ecd1f41c))
* **waitlist:** an Invite button that mails a waitlist entry its code ([429ab19](https://github.com/fabkho/libellus/commit/429ab1962b0be07f1dde834fc239c192bd60cbfe))
* **waitlist:** an invite code per waitlist entry for the owner ([114f0e9](https://github.com/fabkho/libellus/commit/114f0e9e88f1224ec78af760f43be51ec5124535))
* **waitlist:** invite an entry from the data layer ([80bfe66](https://github.com/fabkho/libellus/commit/80bfe668c78f65af449cba5c715b6f770eadad6f))
* **waitlist:** the invite mail in Libellus' design ([f84f2a0](https://github.com/fabkho/libellus/commit/f84f2a097d18ca1d3cf1c580a3583564a9ba764a))
* **waitlist:** the waitlist-invite edge function mails an entry its code ([eac589b](https://github.com/fabkho/libellus/commit/eac589bbd95fb0d5809bf4338d4b7f420c4f060f))


### Fixes

* **e2e:** keep Home's greeting out of the avatar flight's ring probe ([28121cd](https://github.com/fabkho/libellus/commit/28121cdff13e7d9f014f4120a206de0d2c647a0f))
* **e2e:** keep Home's greeting out of the avatar flight's ring probe ([a8611be](https://github.com/fabkho/libellus/commit/a8611beb1a948b8d7fc34277cf81e175b34eebd9))
* **e2e:** open an address only from a page the app has finished starting ([a50e28e](https://github.com/fabkho/libellus/commit/a50e28e89fe26bd1a0d4acf49382dce8435ac454))

## [1.2.0](https://github.com/fabkho/libellus/compare/v1.1.0...v1.2.0) (2026-10-07)


### Features

* a waitlist on the reading page instead of "Ask for an invite", the owner's list, the cover flight and a Favourites inset fix ([0adbe00](https://github.com/fabkho/libellus/commit/0adbe0018a4c1b48d1db0a07f6be8dc809aaa12f))
* **book:** show Read as as one row of icon segments like the format row ([ff78a2d](https://github.com/fabkho/libellus/commit/ff78a2dedc548013f05c66d38c39baa1cbfcfe55))
* **db:** add the waitlist for visitors of a reading page ([932cae7](https://github.com/fabkho/libellus/commit/932cae75de315cd7ed1ed1ff33e56b7837cc88fa))
* **db:** give a list's rows their linked authors in one call ([4b2bc2b](https://github.com/fabkho/libellus/commit/4b2bc2b616098515eee6e5eb9fa0eb5865b8919e))
* genres in the app (chips, editor, Library filter, Profile figures) ([b224303](https://github.com/fabkho/libellus/commit/b2243036ff99de79398d2289cf68035da376fe73))
* **web:** "Next in your series" on Home ([588a29a](https://github.com/fabkho/libellus/commit/588a29af6904eb9748f2896830abc1bdff8d7e89))
* **web:** add Profile → Account → Waitlist for the instance owner ([e9f628c](https://github.com/fabkho/libellus/commit/e9f628ca0dee58329795e3680788bfb77bdef4ee))
* **web:** add the waitlist repository, its store and data-layer tests ([171e1ff](https://github.com/fabkho/libellus/commit/171e1ff70ff657733076146543688de9e5e68ef7))
* **web:** author pages and series ([#167](https://github.com/fabkho/libellus/issues/167)) ([17a7321](https://github.com/fabkho/libellus/commit/17a732121305cbb40e01e0f492d27eb08aedf229))
* **web:** fly a tapped cover into its Book card on the public reading page ([be8a14a](https://github.com/fabkho/libellus/commit/be8a14a6ccb866512d2f00238b8c65ea99704524))
* **web:** name the author page's genres with the canonical labels ([f4bf504](https://github.com/fabkho/libellus/commit/f4bf5049c1ef298dd39438039768fb0787c5f578))
* **web:** open an author's page from the Book page and from Library rows ([9392dfc](https://github.com/fabkho/libellus/commit/9392dfc735995e3ab3a3a336dadb1b97889f2b07))
* **web:** replace "Ask for an invite" with a waitlist form on the reading page ([48a157c](https://github.com/fabkho/libellus/commit/48a157ccf6ef6fc47daf378b541a1dde047d83a4))
* **web:** stores for author pages and series, kept on the device ([04ed876](https://github.com/fabkho/libellus/commit/04ed876543b2ffcd0ee8a7dd7df5026e25430c50))
* **web:** the author page ([668e8ea](https://github.com/fabkho/libellus/commit/668e8ea10c9096b545e71d8906bdd3dfdc220d2f))
* **web:** the series line, the series sheet and her correction on the Book page ([7133ceb](https://github.com/fabkho/libellus/commit/7133ceba80353f95196fd4aa01e008058b2d614d))


### Fixes

* **a11y:** reach What's new's notes by keyboard and scan the Profile only once it has faded in ([a1b84d4](https://github.com/fabkho/libellus/commit/a1b84d4b210f9d0fa9148317d0ed42a840108303))
* **a11y:** What's new notes reachable by keyboard, Profile scanned only once settled ([effe7ab](https://github.com/fabkho/libellus/commit/effe7abccb779821ead089e6b88deb5cc74cafc1))
* **edition:** keep Look up only as the button in Find your edition ([3a1a7b8](https://github.com/fabkho/libellus/commit/3a1a7b8895b3b8536c77522439828e83a447ca09))
* **enrich:** name works in her language, else English, never another language by default ([44e7b2d](https://github.com/fabkho/libellus/commit/44e7b2d6489df1857c3ed3da44a8ab00cca9648d))
* **glass:** make Off mean no transparency, and rename the levels Strong, Medium, Off ([598443d](https://github.com/fabkho/libellus/commit/598443dd2cd5f6103d78f7af785b4bef386e768a))
* **glass:** make Strong heavier and Medium clearly in between ([7855ae2](https://github.com/fabkho/libellus/commit/7855ae2ea630a86d08d99508c5ce6eea91515771))
* **profile:** fly the avatar's ring with its photo ([ea4a0e2](https://github.com/fabkho/libellus/commit/ea4a0e2419e87b11181fe1f6761c38361245666c))
* **profile:** fly the avatar's ring with its photo ([8c21e8f](https://github.com/fabkho/libellus/commit/8c21e8f5a5eb76df3510b61e0f1f937495afdd2d))
* **release:** let the summary say 'none' when no migration was pending ([5d44433](https://github.com/fabkho/libellus/commit/5d44433c9e21f47ec84ffafcb808fa07d2aff6fb))
* **release:** summary step fails when no migration was pending ([b563b8e](https://github.com/fabkho/libellus/commit/b563b8eb0ee20c79e0d2f18f54878ee717b47910))
* **web:** keep the reading page's cover rows inside the side padding ([465a121](https://github.com/fabkho/libellus/commit/465a121f02d7578b8b4ac461331f356f1c987de0))
* **web:** let the reader's book pages load their stylesheets under the site's policy ([8680430](https://github.com/fabkho/libellus/commit/868043010078992f5be1b7485d99fa9acd88da20))
* **web:** under Reduce Motion, only what has a transition takes the 1 ms one ([b5912df](https://github.com/fabkho/libellus/commit/b5912df3098367492374148c5eb263a9e172b407))


### Performance

* **book:** measure whether the title is cut once the cover has landed ([5c61020](https://github.com/fabkho/libellus/commit/5c61020d03489a33023e848b7f173bf38820e543))
* **book:** send a book page's requests once per open ([45ca8f1](https://github.com/fabkho/libellus/commit/45ca8f1224b3ec0322f0d450e85e1c65234ddbd1))
* **dates:** build each Intl formatter once per locale and options ([0a70c78](https://github.com/fabkho/libellus/commit/0a70c7841433ad8cbd1e683f864d287665f9182e))
* **library:** apply a refreshed Library once motion has settled, and save it on idle ([960cdb9](https://github.com/fabkho/libellus/commit/960cdb9e7fa44c91c6172d4303e879a43bcfb1d2))
* **library:** keep unchanged entries across a refresh and hold the lists shallowly ([96562eb](https://github.com/fabkho/libellus/commit/96562eb7c68e186244b0d7c63b51a621b6c63214))
* the remaining quick wins and structural sharing in the library store ([eae9d12](https://github.com/fabkho/libellus/commit/eae9d12fe6ecb527ca6d5271511ffe2b72e6eabc))

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
