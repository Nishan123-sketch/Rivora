
require('dotenv').config();

async function testKma() {
  const url = new URL(
    'https://apihub.kma.go.kr/api/typ01/url/kma_sfctm2.php'
  );

  url.searchParams.set('stn', '0');
  url.searchParams.set('help', '0');
  url.searchParams.set('authKey', process.env.KMA_API_KEY);

  try {
    const response = await fetch(url);
    const result = await response.text();

    console.log('HTTP status:', response.status);
    console.log('KMA response preview:');
    console.log(result.slice(0, 1500));
  } catch (error) {
    console.error('KMA request failed:', error.message);
  }
}

testKma();
