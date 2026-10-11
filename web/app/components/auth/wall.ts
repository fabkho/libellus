// The wall behind sign-in: Fabian's best-rated reads and the books the design
// round was drawn with, as Apple Books covers (600×900, CORS open). Nobody is
// signed in on these screens, so the wall can't show a member's own books.
// Hotlinked, loaded with low priority over the cloth-coloured placeholder, at the size the wall
// draws (components/auth/Frame.vue asks for `lg`: the URL's 600x900 is rewritten by `coverSrc`).
export const WALL_COVERS: readonly { title: string, author: string, cover: string }[] = [
  { title: 'Dune', author: 'Frank Herbert', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/85/70/2f/85702f34-2982-e2ee-d883-b5ffc3ae0897/9781101658055.d.jpg/600x900bb.jpg' },
  { title: 'Stoner', author: 'John Williams', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication125/v4/bf/1f/bc/bf1fbcda-11b3-4cee-2909-1104ebe422b6/9781590173930.jpg/600x900bb.jpg' },
  { title: 'Piranesi', author: 'Susanna Clarke', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/2c/2e/b4/2c2eb4b8-6a28-c926-b0ed-03fbd7ed2ce0/1031214040.jpg/600x900bb.jpg' },
  { title: 'Hyperion', author: 'Dan Simmons', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/8b/c8/4a/8bc84a3e-bd3e-cabd-f5e2-a8739f9cad91/9780307781888.d.jpg/600x900bb.jpg' },
  { title: 'Project Hail Mary', author: 'Andy Weir', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/13/fb/63/13fb6355-fce2-0e4b-08b7-48452037759a/9780593135211.d.jpg/600x900bb.jpg' },
  { title: 'The Carpet Makers', author: 'Andreas Eschbach', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/8c/aa/9d/8caa9d7e-fc0c-7e9b-c226-0581f81a9700/1059114320.jpg/600x900bb.jpg' },
  { title: 'Flowers for Algernon', author: 'Daniel Keyes', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/b4/b3/d5/b4b3d5b1-0dd6-abf5-7856-965e628b9fc1/9780547539638.jpg/600x900bb.jpg' },
  { title: 'Ubik', author: 'Philip K. Dick', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/d8/83/55/d8835508-3e61-54ec-27e0-b6b4d0c86a76/9780547728247.jpg/600x900bb.jpg' },
  { title: 'Red Rising', author: 'Pierce Brown', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication1/v4/10/1f/b7/101fb78b-a06b-3427-8876-773ed9bc8351/9780345539793.jpg/600x900bb.jpg' },
  { title: 'Use of Weapons', author: 'Iain M. Banks', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication113/v4/b1/c4/35/b1c4350e-2063-d273-2231-853bff00db6e/9780316068796.jpg/600x900bb.jpg' },
  { title: 'Small Gods', author: 'Terry Pratchett', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/3b/84/cc/3b84ccb0-a252-40be-183b-19b5c098654a/9780061803208.jpg/600x900bb.jpg' },
  { title: 'Tuesdays with Morrie', author: 'Mitch Albom', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/ed/e4/63/ede463a3-a899-9d31-ce86-98816dcb7181/9780307414090.d.jpg/600x900bb.jpg' },
  { title: 'There Is No Antimemetics Division', author: 'qntm', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c-53b3-7373-ad0e-561c68761d74/9780593983768.d.jpg/600x900bb.jpg' },
  { title: 'Howling Dark', author: 'Christopher Ruocchio', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication112/v4/1b/5d/b0/1b5db081-7488-c533-fb17-8ab7eec1f49e/9780756413057.d.jpg/600x900bb.jpg' },
  { title: 'Do Androids Dream of Electric Sheep?', author: 'Philip K. Dick', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication123/v4/09/46/bc/0946bcea-bf39-686e-9b02-66e5ebfcc58e/9780345508553.d.jpg/600x900bb.jpg' },
  { title: 'Good Omens', author: 'Neil Gaiman', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication126/v4/4a/c4/3c/4ac43c1a-ccd8-8abf-a18d-3df2232c8180/9780061991127.jpg/600x900bb.jpg' },
  { title: 'Ruin', author: 'John Gwynne', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication18/v4/cf/40/60/cf406087-2bbf-ed33-73ba-f6e6b2375bd9/mzm.jkfqpgso.jpg/600x900bb.jpg' },
  { title: 'The Word for World Is Forest', author: 'Ursula K. Le Guin', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication/62/b5/91/mzi.ioyhzhmc.jpg/600x900bb.jpg' },
  { title: 'Roadside Picnic', author: 'Arkady Strugatsky', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication6/v4/02/7c/aa/027caae8-d826-f17d-30a3-1e75d5bfd187/9781473208735.jpg/600x900bb.jpg' },
  { title: 'The Sandman: Preludes & Nocturnes', author: 'Neil Gaiman', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Publication4/v4/2c/e3/68/2ce3683c-ce5f-866b-072d-952108c35b0c/SANDMAN_v1_PN_cover.jpg/600x900bb.jpg' },
]
