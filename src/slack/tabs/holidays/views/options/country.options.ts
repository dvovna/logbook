import { PlainTextOption } from '@slack/web-api';

export const COUNTRY_OPTIONS: PlainTextOption[] = [
  // Europe
  { text: { type: 'plain_text', text: '🇩🇪 Germany' }, value: 'DE' },
  { text: { type: 'plain_text', text: '🇵🇱 Poland' }, value: 'PL' },
  { text: { type: 'plain_text', text: '🇧🇾 Belarus' }, value: 'BY' },
  { text: { type: 'plain_text', text: '🇪🇸 Spain' }, value: 'ES' },
  { text: { type: 'plain_text', text: '🇫🇷 France' }, value: 'FR' },
  { text: { type: 'plain_text', text: '🇮🇹 Italy' }, value: 'IT' },
  { text: { type: 'plain_text', text: '🇬🇧 United Kingdom' }, value: 'GB' },
  { text: { type: 'plain_text', text: '🇳🇱 Netherlands' }, value: 'NL' },
  { text: { type: 'plain_text', text: '🇧🇪 Belgium' }, value: 'BE' },
  { text: { type: 'plain_text', text: '🇨🇿 Czechia' }, value: 'CZ' },
  { text: { type: 'plain_text', text: '🇸🇰 Slovakia' }, value: 'SK' },
  { text: { type: 'plain_text', text: '🇦🇹 Austria' }, value: 'AT' },
  { text: { type: 'plain_text', text: '🇨🇭 Switzerland' }, value: 'CH' },
  { text: { type: 'plain_text', text: '🇸🇪 Sweden' }, value: 'SE' },
  { text: { type: 'plain_text', text: '🇳🇴 Norway' }, value: 'NO' },
  { text: { type: 'plain_text', text: '🇩🇰 Denmark' }, value: 'DK' },
  { text: { type: 'plain_text', text: '🇫🇮 Finland' }, value: 'FI' },
  { text: { type: 'plain_text', text: '🇪🇪 Estonia' }, value: 'EE' },
  { text: { type: 'plain_text', text: '🇱🇻 Latvia' }, value: 'LV' },
  { text: { type: 'plain_text', text: '🇱🇹 Lithuania' }, value: 'LT' },
  { text: { type: 'plain_text', text: '🇷🇴 Romania' }, value: 'RO' },
  { text: { type: 'plain_text', text: '🇧🇬 Bulgaria' }, value: 'BG' },
  { text: { type: 'plain_text', text: '🇭🇺 Hungary' }, value: 'HU' },
  { text: { type: 'plain_text', text: '🇬🇷 Greece' }, value: 'GR' },
  { text: { type: 'plain_text', text: '🇵🇹 Portugal' }, value: 'PT' },
  { text: { type: 'plain_text', text: '🇮🇪 Ireland' }, value: 'IE' },
  { text: { type: 'plain_text', text: '🇭🇷 Croatia' }, value: 'HR' },
  { text: { type: 'plain_text', text: '🇸🇮 Slovenia' }, value: 'SI' },

  // North America
  { text: { type: 'plain_text', text: '🇺🇸 USA' }, value: 'US' },
  { text: { type: 'plain_text', text: '🇨🇦 Canada' }, value: 'CA' },

  // South America
  { text: { type: 'plain_text', text: '🇧🇷 Brazil' }, value: 'BR' },
  { text: { type: 'plain_text', text: '🇦🇷 Argentina' }, value: 'AR' },

  // Asia
  { text: { type: 'plain_text', text: '🇯🇵 Japan' }, value: 'JP' },
  { text: { type: 'plain_text', text: '🇰🇷 South Korea' }, value: 'KR' },
  { text: { type: 'plain_text', text: '🇨🇳 China' }, value: 'CN' },
  { text: { type: 'plain_text', text: '🇮🇳 India' }, value: 'IN' },

  // Oceania
  { text: { type: 'plain_text', text: '🇦🇺 Australia' }, value: 'AU' },
  { text: { type: 'plain_text', text: '🇳🇿 New Zealand' }, value: 'NZ' },
];
