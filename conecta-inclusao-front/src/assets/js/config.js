(function () {
    const currentHost = window.location.hostname;
    const isLocalhost = currentHost === 'localhost' || currentHost === '127.0.0.1';

    window.APP_CONFIG = window.APP_CONFIG || {};

    const configuredBaseUrl = window.APP_CONFIG.API_BASE_URL || window.APP_CONFIG.BASE_URL;

    window.APP_CONFIG.API_BASE_URL = configuredBaseUrl || (
        isLocalhost ? 'http://localhost:3000' : 'https://conecta-inclusao.onrender.com'
    );

    window.APP_CONFIG.AUTH_API_URL = window.APP_CONFIG.AUTH_API_URL || `${window.APP_CONFIG.API_BASE_URL}/auth`;
    window.APP_CONFIG.API_URL = window.APP_CONFIG.API_URL || `${window.APP_CONFIG.API_BASE_URL}/api`;
})();
