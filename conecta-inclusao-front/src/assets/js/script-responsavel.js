// Login do responsavel. Aceita CPF ou e-mail: o CPF passou a fazer parte do
// cadastro do responsavel, mas quem foi cadastrado antes disso so tem e-mail.

function ehEmail(valor) {
    return String(valor).includes('@');
}

/**
 * Aplica mascara de CPF apenas enquanto o texto parecer um CPF. Sem isso, um
 * e-mail digitado no mesmo campo seria mutilado pela mascara.
 */
function aplicarMascaraSeCPF(input) {
    const valor = input.value;
    if (ehEmail(valor)) return;

    const digitos = valor.replace(/\D/g, '');
    if (!digitos) return;

    let v = digitos.slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    input.value = v;
}

async function loginResponsavelAPI(identifier, password) {
    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/login/responsavel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });
        const result = await response.json();
        return { ok: response.ok, data: result };
    } catch (error) {
        console.error('Erro na requisição de login:', error);
        return { ok: false, data: { message: 'Erro de conexão com o servidor.' } };
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const identifierInput = document.getElementById('identifier');
    if (identifierInput) {
        identifierInput.addEventListener('input', () => aplicarMascaraSeCPF(identifierInput));
    }

    const form = document.getElementById('loginFormResponsavel');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
        event.preventDefault();

        const button = form.querySelector('.btn-login');
        const textoOriginal = button.innerText;
        const identifierBruto = identifierInput.value.trim();
        const password = document.getElementById('password').value;

        if (!identifierBruto || !password) {
            showPopup('Informe seu CPF (ou e-mail) e a senha.');
            return;
        }

        // O backend espera o CPF sem pontuacao; o e-mail vai como esta.
        const identifier = ehEmail(identifierBruto)
            ? identifierBruto.toLowerCase()
            : identifierBruto.replace(/\D/g, '');

        if (!ehEmail(identifierBruto) && identifier.length !== 11) {
            showPopup('CPF inválido. Informe os 11 dígitos ou use seu e-mail.');
            return;
        }

        button.disabled = true;
        button.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Acessando...';

        const result = await loginResponsavelAPI(identifier, password);

        if (result.ok) {
            window.ConectaSession.saveSession(result.data.token, result.data.user);
            window.location.href = 'dash-responsavel.html';
            return;
        }

        showPopup(result.data.message || 'Não foi possível entrar. Confira seus dados.');
        button.disabled = false;
        button.innerText = textoOriginal;
    });
});
