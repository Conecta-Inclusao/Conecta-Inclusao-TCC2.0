const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targetFile = path.join(projectRoot, 'src', 'assets', 'js', 'config.js');

const fallbackBaseUrl = process.env.NODE_ENV === 'production'
  ? 'https://conecta-inclusao.onrender.com'
  : 'http://localhost:3000';

const baseUrl = process.env.API_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || process.env.VITE_API_BASE_URL
  || process.env.REACT_APP_API_BASE_URL
  || fallbackBaseUrl;

const authApiUrl = process.env.AUTH_API_URL || `${baseUrl}/auth`;
const apiUrl = process.env.API_URL || `${baseUrl}/api`;

const content = `(() => {
  const currentHost = window.location.hostname;
  const isLocalhost = currentHost === 'localhost' || currentHost === '127.0.0.1';
  const fallbackBaseUrl = isLocalhost ? 'http://localhost:3000' : 'https://conecta-inclusao.onrender.com';

  window.APP_CONFIG = window.APP_CONFIG || {};
  window.APP_CONFIG.API_BASE_URL = window.APP_CONFIG.API_BASE_URL || window.__APP_CONFIG__?.API_BASE_URL || '${baseUrl}';
  window.APP_CONFIG.AUTH_API_URL = window.APP_CONFIG.AUTH_API_URL || window.__APP_CONFIG__?.AUTH_API_URL || '${authApiUrl}';
  window.APP_CONFIG.API_URL = window.APP_CONFIG.API_URL || window.__APP_CONFIG__?.API_URL || '${apiUrl}';
})();
`;

fs.writeFileSync(targetFile, content, 'utf8');
console.log(`Configuração gerada em ${path.relative(projectRoot, targetFile)}`);
console.log(`Base URL: ${baseUrl}`);
