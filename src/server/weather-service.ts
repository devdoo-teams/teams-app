export type WeatherIcon = 'sun' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export type WeatherResponse = {
  source: 'open-meteo' | 'demo';
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    time: string;
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    precipitation: number;
    weatherCode: number;
    isDay: boolean;
    windSpeed: number;
    condition: string;
    icon: WeatherIcon;
  };
};

type OpenMeteoResponse = {
  timezone?: unknown;
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    relative_humidity_2m?: unknown;
    apparent_temperature?: unknown;
    precipitation?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    wind_speed_10m?: unknown;
  };
};

const DEMO_COORDINATES = { latitude: 37.5665, longitude: 126.978 };

function numberValue(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`날씨 응답의 ${field} 값이 올바르지 않습니다.`);
  return result;
}

export function validateCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function weatherDescription(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: '맑음', icon: 'sun' };
  if (code <= 3) return { condition: '구름 조금', icon: 'cloud' };
  if (code <= 48) return { condition: '안개', icon: 'fog' };
  if (code <= 57) return { condition: '이슬비', icon: 'rain' };
  if (code <= 67 || (code >= 80 && code <= 82)) return { condition: '비', icon: 'rain' };
  if (code <= 77 || (code >= 85 && code <= 86)) return { condition: '눈', icon: 'snow' };
  return { condition: '뇌우', icon: 'storm' };
}

function createDemoWeather(latitude = DEMO_COORDINATES.latitude, longitude = DEMO_COORDINATES.longitude): WeatherResponse {
  const now = new Date().toISOString();
  return {
    source: 'demo',
    location: {
      name: '서울 · 데모 위치',
      latitude,
      longitude,
      timezone: 'Asia/Seoul',
    },
    current: {
      time: now,
      temperature: 22,
      apparentTemperature: 22.8,
      humidity: 58,
      precipitation: 0,
      weatherCode: 0,
      isDay: true,
      windSpeed: 9.4,
      condition: '맑음',
      icon: 'sun',
    },
  };
}

export async function getWeather(
  latitude: number,
  longitude: number,
  options: { demo?: boolean } = {},
): Promise<WeatherResponse> {
  if (options.demo || process.env.WEATHER_MODE === 'demo') {
    return createDemoWeather(latitude, longitude);
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`날씨 제공자 응답 오류 (${response.status})`);

  const payload = (await response.json()) as OpenMeteoResponse;
  const current = payload.current;
  if (!current) throw new Error('날씨 제공자 응답에 현재 날씨가 없습니다.');

  const weatherCode = numberValue(current.weather_code, 'weather_code');
  const description = weatherDescription(weatherCode);
  return {
    source: 'open-meteo',
    location: {
      name: '현재 위치',
      latitude,
      longitude,
      timezone: typeof payload.timezone === 'string' ? payload.timezone : 'auto',
    },
    current: {
      time: typeof current.time === 'string' ? current.time : new Date().toISOString(),
      temperature: numberValue(current.temperature_2m, 'temperature_2m'),
      apparentTemperature: numberValue(current.apparent_temperature, 'apparent_temperature'),
      humidity: numberValue(current.relative_humidity_2m, 'relative_humidity_2m'),
      precipitation: numberValue(current.precipitation, 'precipitation'),
      weatherCode,
      isDay: numberValue(current.is_day, 'is_day') === 1,
      windSpeed: numberValue(current.wind_speed_10m, 'wind_speed_10m'),
      condition: description.condition,
      icon: description.icon,
    },
  };
}

export function formatWeatherMessage(weather: WeatherResponse, usesDemoLocation = false): string {
  const { current, location } = weather;
  const sourceHint = weather.source === 'demo'
    ? '\n\n탭에서 위치 권한을 허용하면 현재 위치의 실시간 날씨를 확인할 수 있습니다.'
    : '';
  const locationHint = usesDemoLocation ? ' (Bot 데모 위치)' : '';

  return [
    `날씨 위젯 · ${location.name}${locationHint}`,
    `${current.condition} · ${current.temperature.toFixed(1)}°C (체감 ${current.apparentTemperature.toFixed(1)}°C)`,
    `습도 ${Math.round(current.humidity)}% · 바람 ${current.windSpeed.toFixed(1)}km/h · 강수 ${current.precipitation.toFixed(1)}mm`,
    `좌표 ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} · ${location.timezone}`,
    `데이터: ${weather.source === 'demo' ? '데모' : 'Open-Meteo'}`,
    sourceHint,
  ].filter(Boolean).join('\n');
}

export { DEMO_COORDINATES };
