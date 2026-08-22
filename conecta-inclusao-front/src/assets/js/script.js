// Navegacao da porta de entrada (lndex.html).
//
// A versao anterior procurava `.bio-portal-container` para animar a saida.
// Esse container nao existe mais (a entrada foi redesenhada) e o mesmo arquivo
// tambem e carregado pelo dashboard da empresa, entao a busca as cegas
// quebrava com TypeError fora da pagina inicial. Agora o alvo da animacao e
// opcional e a navegacao acontece de qualquer forma.
function navTo(tipo) {
    const rotas = {
        medico: 'login-medico.html',
        empresa: 'login-empresa.html',
        paciente: 'login-paciente.html',
        responsavel: 'login-responsavel.html'
    };

    const targetUrl = rotas[tipo] || 'lndex.html';

    const main = document.querySelector('main');
    const semAnimacao = document.documentElement.getAttribute('data-motion') === 'reduzido'
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!main || semAnimacao) {
        window.location.href = targetUrl;
        return;
    }

    main.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
    main.style.opacity = '0';
    main.style.transform = 'translateY(8px)';

    setTimeout(() => {
        window.location.href = targetUrl;
    }, 250);
}
