function loadCompanyInfo() {
    const storedUser = window.ConectaSession.getUser();
    if (storedUser.profile && storedUser.profile !== 'clinica') {
        window.ConectaSession.clearSession();
        window.location.href = 'login-empresa.html';
        return;
    }

    const fantasyName = storedUser.name || storedUser.nome || sessionStorage.getItem('empresaNomeFantasia') || 'Empresa';
    const companyCnpj = storedUser.cnpj || sessionStorage.getItem('empresaCnpj') || '';
    const companyHeaderName = document.getElementById('companyHeaderName');
    const companySidebarName = document.getElementById('companySidebarName');
    const companyHeaderCnpj = document.getElementById('companyHeaderCnpj');
    const companyAvatar = document.getElementById('companyAvatar');

    if (companyHeaderName) companyHeaderName.innerText = fantasyName;
    if (companySidebarName) companySidebarName.innerText = fantasyName;
    if (companyHeaderCnpj) companyHeaderCnpj.innerText = companyCnpj ? `CNPJ ${companyCnpj}` : 'CNPJ nao informado';
    if (companyAvatar) {
        companyAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fantasyName)}&background=0073e6&color=fff`;
    }
}

function switchTab(tabKey) {
    const tabs = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.nav-link');

    tabs.forEach(tab => tab.classList.toggle('active', tab.id === tabKey));
    buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabKey));
}

async function handleLogout() {
    const result = await showPopup('Deseja realmente sair?', 'confirm');
    if (result) {
        window.ConectaSession.clearSession();
        sessionStorage.removeItem('empresaNomeFantasia');
        sessionStorage.removeItem('empresaCnpj');
        sessionStorage.removeItem('empresaRazaoSocial');
        window.location.href = 'login-empresa.html';
    }
}

window.handleLogout = handleLogout;

document.addEventListener('DOMContentLoaded', () => {
    loadCompanyInfo();

    const navButtons = document.querySelectorAll('.nav-link');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const addButton = document.getElementById('btnAddProfessional');
    if (addButton) {
        addButton.addEventListener('click', () => switchTab('register'));
    }
});
