// 사람 증명사진 + 반려동물 사진 → 사진관 배경 합성 이미지 5장 생성
// gpt-image-1 (OpenAI Images API, edit endpoint - 여러 장의 입력 이미지를 한 번에 참조 가능)
//
// ⚠️ 프롬프트는 항상 영어로 작성 (본인 지정 규칙)
// ⚠️ 공통 배경/스튜디오 묘사를 따로 분리하지 않고, 5개 프롬프트 각각에 전체 내용을 반복 삽입 (본인 지정 규칙)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

// 서버 기동 시점에는 키가 없을 수도 있으니(아직 설정 전) 여기서 바로 인스턴스화하지 않고
// 실제 생성 호출 시점에만 만든다. (모듈 로드 시 생성하면 키 없을 때 서버 자체가 죽어버림)
let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// 공통 스튜디오 배경 문구 (설명용 상수일 뿐, 실제 API 호출 시에는 아래 5개 프롬프트 각각에
// 이미 전체 문장으로 풀어서 들어가 있음 - 분리해서 조립하지 않음)
const STUDIO_DESC =
  'a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere';

const STYLE_PROMPTS = [
  {
    key: 'hug',
    label: '서로 안고있는 사진',
    prompt: `Using three reference photos — a person's portrait photo, a pet's photo, and a photo studio room with a sofa — create one photorealistic professional family portrait that places the person and pet naturally into the exact studio room shown in the third reference photo, matching its wall color, sofa, flooring, and lighting exactly; do not invent a different room. Frame it as a medium-wide shot that clearly shows the sofa and surrounding room so it doesn't look like a tight close-up, leaving comfortable space around the subjects on all sides, bright and evenly lit, shallow depth of field, professional portrait photography, cheerful and upbeat atmosphere. The person is tenderly hugging and cradling the pet close to their chest, both looking affectionate with a big bright genuine smile and happy sparkling eyes, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Horizontal orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'smile',
    label: '정면 보고 웃는 평범한 사진',
    prompt: `Using three reference photos — a person's portrait photo, a pet's photo, and a photo studio room with a sofa — create one photorealistic professional family portrait that places the person and pet naturally into the exact studio room shown in the third reference photo, matching its wall color, sofa, flooring, and lighting exactly; do not invent a different room. Frame it as a medium-wide shot that clearly shows the sofa and surrounding room so it doesn't look like a tight close-up, leaving comfortable space around the subjects on all sides, bright and evenly lit, shallow depth of field, professional portrait photography, cheerful and upbeat atmosphere. The person sits on the sofa holding the pet on their lap, both facing the camera directly with a big bright cheerful smile, eyes crinkled with joy, classic straightforward family portrait pose, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Horizontal orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'cone-hat',
    label: '고깔 쓴 귀여운 사진',
    prompt: `Using three reference photos — a person's portrait photo, a pet's photo, and a photo studio room with a sofa — create one photorealistic professional family portrait that places the person and pet naturally into the exact studio room shown in the third reference photo, matching its wall color, sofa, flooring, and lighting exactly; do not invent a different room. Frame it as a medium-wide shot that clearly shows the sofa and surrounding room so it doesn't look like a tight close-up, leaving comfortable space around the subjects on all sides, bright and evenly lit, shallow depth of field, professional portrait photography, cheerful and upbeat atmosphere. Both the person and the pet are wearing cute colorful birthday party cone hats with small pom-poms on top, both smiling brightly with big joyful grins and looking cheerful and playful, festive and fun mood, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Horizontal orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'hanbok',
    label: '한복 입은 사진',
    prompt: `Using three reference photos — a person's portrait photo, a pet's photo, and a photo studio room with a sofa — create one photorealistic professional family portrait that places the person and pet naturally into the exact studio room shown in the third reference photo, matching its wall color, sofa, flooring, and lighting exactly; do not invent a different room. Frame it as a medium-wide shot that clearly shows the sofa and surrounding room so it doesn't look like a tight close-up, leaving comfortable space around the subjects on all sides, bright and evenly lit, shallow depth of field, professional portrait photography, cheerful and upbeat atmosphere. Both the person and the pet are dressed in beautiful traditional Korean hanbok with vivid jewel-toned silk fabric and elegant embroidery, sized appropriately for each (a small tailored hanbok-style outfit for the pet), both looking graceful and proud with a big bright warm smile, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Horizontal orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'military',
    label: '군복 입은 사진',
    prompt: `Using three reference photos — a person's portrait photo, a pet's photo, and a photo studio room with a sofa — create one photorealistic professional family portrait that places the person and pet naturally into the exact studio room shown in the third reference photo, matching its wall color, sofa, flooring, and lighting exactly; do not invent a different room. Frame it as a medium-wide shot that clearly shows the sofa and surrounding room so it doesn't look like a tight close-up, leaving comfortable space around the subjects on all sides, bright and evenly lit, shallow depth of field, professional portrait photography, cheerful and upbeat atmosphere. Both the person and the pet are wearing matching military-style uniforms (a small tailored uniform outfit for the pet), standing proud with a confident, bright, and endearing smile, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Horizontal orientation, high resolution, no text, no watermark.`,
  },
];

// 사진관 배경 후보 4장 - 주문 하나당 랜덤으로 1장 골라서 5장 전부 같은 배경으로 통일
// (한 세션에 찍은 것처럼 보이도록 주문당 1회만 뽑음, 사진마다 바뀌지 않게)
const BACKGROUND_IMAGES = [
  path.join(__dirname, '..', 'assets', 'backgrounds', 'studio-1.jpg'),
  path.join(__dirname, '..', 'assets', 'backgrounds', 'studio-2.jpg'),
  path.join(__dirname, '..', 'assets', 'backgrounds', 'studio-3.jpg'),
  path.join(__dirname, '..', 'assets', 'backgrounds', 'studio-4.jpg'),
];

function pickRandomBackground() {
  return BACKGROUND_IMAGES[Math.floor(Math.random() * BACKGROUND_IMAGES.length)];
}

const EXT_TO_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function toOpenAIFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'image/jpeg';
  return toFile(fs.createReadStream(filePath), path.basename(filePath), { type: mimeType });
}

// OpenAI 이미지 API는 정해진 사이즈만 지원해서(5:4로 직접 생성 불가) 가로로 넓게
// 생성한 다음 5:4 비율로 가운데를 정확히 잘라냄.
async function cropTo5by4(inputBuffer) {
  const image = sharp(inputBuffer);
  const { width, height } = await image.metadata();
  const targetRatio = 5 / 4;

  let targetWidth = width;
  let targetHeight = Math.round(width / targetRatio);
  if (targetHeight > height) {
    targetHeight = height;
    targetWidth = Math.round(height * targetRatio);
  }

  const left = Math.round((width - targetWidth) / 2);
  const top = Math.round((height - targetHeight) / 2);
  return image.extract({ left, top, width: targetWidth, height: targetHeight }).toBuffer();
}

// 즉석사진(폴라로이드) 느낌의 흰 테두리 입히기.
// 위/양옆은 얇게, 아래쪽만 살짝 더 두껍게 - AI에게 프롬프트로 시키면 삐뚤빼뚤하거나
// 아예 무시하는 경우가 많아서, 생성된 이미지에 서버에서 직접 정확하게 합성함.
async function addPolaroidBorder(inputBuffer) {
  const image = sharp(inputBuffer);
  const { width, height } = await image.metadata();

  const sideBorder = Math.round(width * 0.035); // 위/양옆: 이미지 가로폭의 3.5%
  const bottomBorder = Math.round(width * 0.09); // 아래: 조금 더 두껍게 (즉석사진 느낌)

  return sharp({
    create: {
      width: width + sideBorder * 2,
      height: height + sideBorder + bottomBorder,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: inputBuffer, top: sideBorder, left: sideBorder }])
    .png()
    .toBuffer();
}

async function generateFiveImages({ personPhotoPath, petPhotoPath, outDir }) {
  const client = getClient();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const backgroundPath = pickRandomBackground();

  const results = [];
  for (const style of STYLE_PROMPTS) {
    const [personFile, petFile, backgroundFile] = await Promise.all([
      toOpenAIFile(personPhotoPath),
      toOpenAIFile(petPhotoPath),
      toOpenAIFile(backgroundPath),
    ]);
    const response = await client.images.edit({
      model: 'gpt-image-1',
      image: [personFile, petFile, backgroundFile],
      prompt: style.prompt,
      size: '1536x1024', // 가로로 넓게 생성 후 5:4로 크롭
      quality: 'high',
      n: 1,
    });

    const b64 = response.data[0].b64_json;
    const rawBuffer = Buffer.from(b64, 'base64');
    const croppedBuffer = await cropTo5by4(rawBuffer);
    const framedBuffer = await addPolaroidBorder(croppedBuffer);
    const outPath = `${outDir}/${style.key}.png`;
    fs.writeFileSync(outPath, framedBuffer);
    results.push({ key: style.key, label: style.label, path: outPath });
  }
  return results;
}

module.exports = { generateFiveImages, STYLE_PROMPTS };
