/* ===========================================================================
   cadastro-empresa.js - criacao da conta da clinica
   ===========================================================================
   O bloco de endereco foi reordenado: o CEP vem primeiro e preenche os demais
   campos. Pedir a rua antes do CEP fazia o usuario digitar exatamente aquilo
   que o formulario ia sobrescrever um segundo depois.

   A consulta de CEP passou a ir pela nossa API (/auth/cep/:cep) em vez de
   chamar o ViaCEP direto do navegador. A CSP definida em app.js libera apenas
   `connect-src 'self'`: quando o front e servido pela propria API, o fetch para
   viacep.com.br era bloqueado antes de sair - funcionava so na Vercel, que
   serve o front sem CSP.
   =========================================================================== */

const AUTH_API = window.APP_CONFIG?.AUTH_API_URL || '/auth';

function applyMask(input, maskFn) {
    input.addEventListener('input', function (event) {
        event.target.value = maskFn(event.target.value);
    });
}

function cnpjMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 14) v = v.slice(0, 14);
    v = v.replace(/(\d{2})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1/$2');
    // O template literal desta linha era `'$1-$2` (com uma aspas simples
    // sobrando no inicio). O resultado ia para a tela como 00.000.000/'0001-00
    // e, como a validacao exigia 18 caracteres, o campo passava com um caractere
    // invalido no meio do documento.
    v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    return v;
}

function cepMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
    return v;
}

function phoneMask(value) {
    let v = value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{5})(\d)/, '$1-$2');
    return v;
}

// ---------------------------------------------------------------------------
// Consulta de CEP
// ---------------------------------------------------------------------------
let ultimoCepConsultado = '';
let controladorCep = null;

function definirDicaDoCep(texto, estado = '') {
    const dica = document.getElementById('zipHint');
    if (!dica) return;

    dica.textContent = texto;
    dica.className = estado ? `field-hint field-hint--${estado}` : 'field-hint';
}

function preencherEndereco(endereco) {
    const rua = document.getElementById('street');
    const cidade = document.getElementById('city');
    const estado = document.getElementById('state');

    // CEP de logradouro unico volta com a rua vazia; nesse caso o campo fica
    // como esta para o usuario completar, em vez de ser apagado.
    if (rua && endereco.logradouro) rua.value = endereco.logradouro;
    if (cidade && endereco.cidade) cidade.value = endereco.cidade;
    if (estado && endereco.estado) estado.value = endereco.estado.toUpperCase();
}

async function consultarCep(event) {
    const campoCep = event.target;
    const digitos = campoCep.value.replace(/\D/g, '');

    if (digitos.length < 8) {
        ultimoCepConsultado = '';
        definirDicaDoCep('Digite o CEP para preencher o endereço automaticamente.');
        return;
    }

    if (digitos === ultimoCepConsultado) return;
    ultimoCepConsultado = digitos;

    if (controladorCep) controladorCep.abort();
    controladorCep = new AbortController();

    definirDicaDoCep('Buscando endereço...');

    try {
        const resposta = await fetch(`${AUTH_API}/cep/${digitos}`, { signal: controladorCep.signal });
        const corpo = await resposta.json();

        if (!resposta.ok) {
            // Permite nova tentativa com o mesmo CEP depois de um erro.
            ultimoCepConsultado = '';
            definirDicaDoCep(corpo.message || 'Não foi possível buscar o endereço.', 'erro');
            return;
        }

        preencherEndereco(corpo);
        definirDicaDoCep('Endereço preenchido. Confira antes de continuar.', 'ok');
    } catch (erro) {
        if (erro.name === 'AbortError') return;
        ultimoCepConsultado = '';
        console.error('Erro ao consultar CEP:', erro);
        definirDicaDoCep('Não foi possível buscar o endereço pelo CEP.', 'erro');
    }
}

// ---------------------------------------------------------------------------
// Numero do endereco
// ---------------------------------------------------------------------------
/**
 * O toggle "o endereço possui número?" mostra ou esconde o campo de numero.
 * Quando desligado, o endereco e gravado com "s/n" - que e como um endereco sem
 * numero se escreve, e nao com o campo simplesmente vazio.
 */
function sincronizarCampoDeNumero() {
    const toggle = document.getElementById('hasStreetNumber');
    const campo = document.getElementById('streetNumberField');
    const numero = document.getElementById('streetNumber');
    if (!toggle || !campo) return;

    const possuiNumero = toggle.checked;
    campo.hidden = !possuiNumero;

    if (numero) {
        numero.required = possuiNumero;
        if (!possuiNumero) numero.value = '';
    }
}

function montarEndereco() {
    const rua = document.getElementById('street').value.trim();
    const possuiNumero = document.getElementById('hasStreetNumber')?.checked;
    const numero = document.getElementById('streetNumber')?.value.trim();
    const complemento = document.getElementById('addressComplement')?.value.trim();

    // clinicas.endereco e uma coluna unica (VARCHAR 255): rua, numero e
    // complemento sao juntados aqui, na ordem do endereco brasileiro.
    return [rua, possuiNumero ? numero : 's/n', complemento]
        .filter(Boolean)
        .join(', ');
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------
function lerFormulario() {
    return {
        companyName: document.getElementById('companyName').value.trim(),
        companyLegalName: document.getElementById('companyLegalName').value.trim(),
        cnpj: document.getElementById('cnpj').value.trim(),
        email: document.getElementById('companyEmail').value.trim(),
        phone: document.getElementById('companyPhone').value.trim(),
        contact: document.getElementById('companyContact').value.trim(),
        role: document.getElementById('contactRole').value.trim(),
        branch: document.getElementById('companyBranch').value.trim(),
        street: document.getElementById('street').value.trim(),
        hasNumber: Boolean(document.getElementById('hasStreetNumber')?.checked),
        number: document.getElementById('streetNumber')?.value.trim() || '',
        city: document.getElementById('city').value.trim(),
        state: document.getElementById('state').value.trim().toUpperCase(),
        zip: document.getElementById('zip').value.trim(),
        password: document.getElementById('password').value,
        confirmPassword: document.getElementById('confirmPassword').value
    };
}

/**
 * Validacao unica do formulario. Antes existiam duas copias da mesma lista de
 * regras - `validateCompanyForm()`, que ninguem chamava, e o mesmo bloco
 * repetido dentro do submit. Duas copias divergem na primeira alteracao.
 */
function validarFormulario(dados) {
    const obrigatorios = [
        dados.companyName, dados.companyLegalName, dados.cnpj, dados.email,
        dados.phone, dados.contact, dados.role, dados.branch,
        dados.street, dados.city, dados.state, dados.zip,
        dados.password, dados.confirmPassword
    ];

    if (obrigatorios.some((valor) => !valor)) {
        return 'Preencha todos os campos obrigatórios antes de continuar.';
    }

    if (dados.hasNumber && !dados.number) {
        return 'Informe o número do endereço ou desligue a opção "O endereço possui número?".';
    }

    if (dados.cnpj.replace(/\D/g, '').length !== 14) {
        return 'Insira um CNPJ válido.';
    }

    if (dados.zip.replace(/\D/g, '').length !== 8) {
        return 'Insira um CEP válido.';
    }

    if (dados.state.length !== 2) {
        return 'Informe o estado em formato UF.';
    }

    if (!isStrongPassword(dados.password)) {
        return 'A senha deve ter 8 caracteres, maiúscula, minúscula, número e caractere especial.';
    }

    if (dados.password !== dados.confirmPassword) {
        return 'As senhas não coincidem.';
    }

    return null;
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
async function registerClinicAPI(data) {
    try {
        const response = await fetch(`${AUTH_API}/register/clinic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição:', error);
        return { ok: false, data: { message: 'Erro de conexão' } };
    }
}

function handleCompanyRegistration(event) {
    event.preventDefault();

    const submitButton = document.querySelector('.btn-register');
    const dados = lerFormulario();
    const erro = validarFormulario(dados);

    if (erro) {
        showPopup(erro);
        return;
    }

    showPopup('Deseja confirmar o cadastro da empresa?', 'confirm').then(async (confirmed) => {
        if (!confirmed) return;

        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Cadastrando...';

        const cnpjDigits = dados.cnpj.replace(/\D/g, '');
        const registrationData = {
            cnpj: cnpjDigits,
            password: dados.password,
            name: dados.companyName,
            email: dados.email,
            razaoSocial: dados.companyLegalName,
            endereco: montarEndereco(),
            cidade: dados.city,
            estado: dados.state,
            cep: dados.zip.replace(/\D/g, ''),
            telefone: dados.phone.replace(/\D/g, ''),
            responsavel: dados.contact
        };

        const result = await registerClinicAPI(registrationData);

        if (result.ok) {
            await showPopup('Cadastro realizado com sucesso! Você pode fazer login agora.');
            document.getElementById('registerCompanyForm').reset();

            // As chaves `lastCNPJ` e `lastRegisteredCNPJ` foram removidas daqui:
            // o CNPJ ficava gravado no localStorage indefinidamente e nenhuma
            // tela chegava a le-lo (a de login da clinica nunca implementou o
            // pre-preenchimento). Era documento da empresa parado no navegador
            // sem servir para nada.
            window.location.href = 'login-empresa.html';
            return;
        }

        showPopup(result.data.message || 'Erro ao cadastrar. Tente novamente.');
        submitButton.disabled = false;
        submitButton.innerText = 'Criar Conta';
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const cnpjInput = document.getElementById('cnpj');
    const zipInput = document.getElementById('zip');
    const phoneInput = document.getElementById('companyPhone');
    const stateInput = document.getElementById('state');
    const numberToggle = document.getElementById('hasStreetNumber');
    const form = document.getElementById('registerCompanyForm');

    if (cnpjInput) applyMask(cnpjInput, cnpjMask);

    if (zipInput) {
        applyMask(zipInput, cepMask);
        zipInput.addEventListener('input', consultarCep);
        zipInput.addEventListener('blur', consultarCep);
    }

    if (phoneInput) applyMask(phoneInput, phoneMask);

    if (stateInput) {
        stateInput.addEventListener('input', (event) => {
            event.target.value = event.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
        });
    }

    if (numberToggle) {
        numberToggle.addEventListener('change', sincronizarCampoDeNumero);
        sincronizarCampoDeNumero();
    }

    if (form) form.addEventListener('submit', handleCompanyRegistration);

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});
