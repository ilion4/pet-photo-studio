// 사람 증명사진 + 반려동물 사진 → 사진관 배경 합성 이미지 5장 생성
// gpt-image-1 (OpenAI Images API, edit endpoint - 여러 장의 입력 이미지를 한 번에 참조 가능)
//
// ⚠️ 프롬프트는 항상 영어로 작성 (본인 지정 규칙)
// ⚠️ 공통 배경/스튜디오 묘사를 따로 분리하지 않고, 5개 프롬프트 각각에 전체 내용을 반복 삽입 (본인 지정 규칙)

const fs = require('fs');
const path = require('path');
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
    prompt: `Using the two reference photos (a person's portrait photo and a pet's photo), create one photorealistic professional studio portrait that combines them into a single warm family portrait. The photo is taken in a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere. The person is tenderly hugging and cradling the pet close to their chest, both looking affectionate, soft genuine smile, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Vertical portrait orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'smile',
    label: '정면 보고 웃는 평범한 사진',
    prompt: `Using the two reference photos (a person's portrait photo and a pet's photo), create one photorealistic professional studio portrait that combines them into a single family portrait. The photo is taken in a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere. The person sits on the sofa holding the pet on their lap, both facing the camera directly with a natural relaxed smile, classic straightforward family portrait pose, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Vertical portrait orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'cone-hat',
    label: '고깔 쓴 귀여운 사진',
    prompt: `Using the two reference photos (a person's portrait photo and a pet's photo), create one photorealistic professional studio portrait that combines them into a single playful family portrait. The photo is taken in a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere. Both the person and the pet are wearing cute colorful birthday party cone hats with small pom-poms on top, both smiling brightly and looking cheerful and playful, festive and fun mood, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Vertical portrait orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'hanbok',
    label: '한복 입은 사진',
    prompt: `Using the two reference photos (a person's portrait photo and a pet's photo), create one photorealistic professional studio portrait that combines them into a single elegant family portrait. The photo is taken in a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere. Both the person and the pet are dressed in beautiful traditional Korean hanbok with vivid jewel-toned silk fabric and elegant embroidery, sized appropriately for each (a small tailored hanbok-style outfit for the pet), both looking graceful and proud, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Vertical portrait orientation, high resolution, no text, no watermark.`,
  },
  {
    key: 'military',
    label: '군복 입은 사진',
    prompt: `Using the two reference photos (a person's portrait photo and a pet's photo), create one photorealistic professional studio portrait that combines them into a single family portrait. The photo is taken in a warm neighborhood family photo studio with a soft gray-beige seamless backdrop, a small tufted sofa, gentle three-point studio lighting, shallow depth of field, professional portrait photography, warm and cozy atmosphere. Both the person and the pet are wearing matching military-style uniforms (a small tailored uniform outfit for the pet), standing proud with a confident and endearing expression, natural skin tones, the pet's fur and the person's face must closely match the reference photos. Vertical portrait orientation, high resolution, no text, no watermark.`,
  },
];

const EXT_TO_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function toOpenAIFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'image/jpeg';
  return toFile(fs.createReadStream(filePath), path.basename(filePath), { type: mimeType });
}

async function generateFiveImages({ personPhotoPath, petPhotoPath, outDir }) {
  const client = getClient();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const style of STYLE_PROMPTS) {
    const [personFile, petFile] = await Promise.all([
      toOpenAIFile(personPhotoPath),
      toOpenAIFile(petPhotoPath),
    ]);
    const response = await client.images.edit({
      model: 'gpt-image-1',
      image: [personFile, petFile],
      prompt: style.prompt,
      size: '1024x1536', // 세로 인물사진 비율
      quality: 'high',
      n: 1,
    });

    const b64 = response.data[0].b64_json;
    const outPath = `${outDir}/${style.key}.png`;
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    results.push({ key: style.key, label: style.label, path: outPath });
  }
  return results;
}

module.exports = { generateFiveImages, STYLE_PROMPTS };
