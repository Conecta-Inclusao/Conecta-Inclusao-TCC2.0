/* ===========================================================================
   acessibilidade.js - painel de preferencias de leitura
   ===========================================================================
   A acessibilidade e o diferencial declarado do projeto, mas ate aqui existia
   so como intencao no README ("estrutura preparada para alto contraste e
   acessibilidade ampliada"). Este arquivo entrega os tres ajustes que mais
   pesam para o publico atendido - criancas e adolescentes com deficiencia e
   seus responsaveis - em todas as telas, sem depender de extensao do
   navegador:

     - tamanho da fonte  (100% / 112% / 125%)
     - alto contraste    (preto/amarelo, WCAG AAA)
     - menos animacao    (para quem tem sensibilidade a movimento)

   A escolha e gravada em localStorage e reaplicada antes da primeira pintura
   da proxima pagina, entao nao ha "piscada" entre navegacoes.

   Nada aqui depende de biblioteca externa: e injetado em qualquer pagina que
   carregue o arquivo, e o CSS correspondente esta em theme.css.
   =========================================================================== */

(function () {
    'use strict';

    const STORAGE_KEY = 'conecta:acessibilidade';

    const FONT_SCALES = {
        padrao: '100%',
        medio: '112.5%',
        grande: '125%'
    };

    const defaults = {
        fonte: 'padrao',
        contraste: 'normal',
        movimento: 'normal',
        // Quais preferencias o proprio usuario ajustou no painel. E o que
        // impede a adaptacao automatica por deficiencia de sobrescrever uma
        // escolha consciente dele - ver aplicarPerfilDeDeficiencia().
        definidoPeloUsuario: {}
    };

    /* -----------------------------------------------------------------------
       Adaptacao por tipo de deficiencia
       -----------------------------------------------------------------------
       O paciente informa o tipo de deficiencia no cadastro, e esse dado ficava
       so guardado no banco, aparecendo como texto na aba "Meu Perfil". Aqui ele
       passa a valer alguma coisa: ao abrir o dashboard, a interface ja nasce
       ajustada ao que aquela pessoa precisa, sem depender de ela descobrir o
       painel de acessibilidade e configurar tudo na mao.

       Cada perfil define (a) preferencias de leitura sugeridas e (b) um
       marcador `data-adaptacao` no <html>, que o CSS usa para mudar espacamento,
       tamanho de alvo e densidade da tela.

       As sugestoes NUNCA vencem uma escolha manual: se a pessoa ja mexeu no
       tamanho da fonte, a adaptacao respeita o que ela escolheu.
       ----------------------------------------------------------------------- */
    const PERFIS_DE_ADAPTACAO = {
        visual: {
            rotulo: 'deficiência visual',
            // Fonte ampliada e alto contraste sao os dois ajustes com maior
            // efeito para baixa visao. Quem usa leitor de tela nao e prejudicado:
            // o marcador tambem reforca foco visivel e rotulos textuais.
            preferencias: { fonte: 'grande', contraste: 'alto' },
            descricao: 'Texto ampliado, alto contraste e foco de teclado reforçado.'
        },
        auditiva: {
            rotulo: 'deficiência auditiva',
            preferencias: {},
            descricao: 'Avisos sempre em texto e destaque para o atendimento por mensagem escrita.'
        },
        motora: {
            rotulo: 'deficiência motora',
            // Movimento reduzido evita que um elemento se desloque no instante
            // do clique - problema real para quem tem pouca precisao motora.
            preferencias: { movimento: 'reduzido' },
            descricao: 'Botões e campos maiores, mais espaço entre eles e menos movimento na tela.'
        },
        cognitiva: {
            rotulo: 'deficiência intelectual ou TEA',
            preferencias: { movimento: 'reduzido', fonte: 'medio' },
            descricao: 'Menos elementos por vez, sem animações e com textos de apoio mais diretos.'
        },
        multipla: {
            rotulo: 'deficiência múltipla',
            preferencias: { fonte: 'grande', contraste: 'alto', movimento: 'reduzido' },
            descricao: 'Combina texto ampliado, alto contraste, alvos maiores e menos movimento.'
        }
    };

    /** Remove acentos e caixa para casar o texto livre vindo do banco. */
    function normalizar(texto) {
        // A faixa do replace e U+0300-U+036F: os sinais diacriticos que o
        // normalize('NFD') separa da letra base. Mesma tecnica ja usada em
        // normalizeText(), no dash-paciente.js.
        return String(texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim();
    }

    /**
     * Traduz o valor gravado em `pacientes.tipo_deficiencia` para um dos perfis
     * acima. A coluna e texto livre (VARCHAR 100) e ja tem variacoes gravadas -
     * por isso o casamento e por palavra-chave, e nao por igualdade exata.
     */
    function perfilParaTipoDeDeficiencia(tipo) {
        const t = normalizar(tipo);
        if (!t) return null;

        if (t.includes('multipla')) return 'multipla';
        if (t.includes('visual') || t.includes('cegueira') || t.includes('baixa visao')) return 'visual';
        if (t.includes('auditiva') || t.includes('surdez') || t.includes('surdo')) return 'auditiva';
        if (t.includes('fisica') || t.includes('motora') || t.includes('cadeirante')) return 'motora';
        if (t.includes('intelectual') || t.includes('autista') || t.includes('autismo')
            || t.includes('espectro') || t.includes('tea') || t.includes('cognitiva')) {
            return 'cognitiva';
        }

        return null;
    }

    function readPreferences() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...defaults, definidoPeloUsuario: {} };

            const salvo = JSON.parse(raw);
            return {
                ...defaults,
                ...salvo,
                definidoPeloUsuario: { ...(salvo.definidoPeloUsuario || {}) }
            };
        } catch (error) {
            // Modo anonimo ou storage bloqueado: segue com o padrao.
            return { ...defaults, definidoPeloUsuario: {} };
        }
    }

    function savePreferences(prefs) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch (error) {
            /* preferencia vale so para esta sessao */
        }
    }

    let preferences = readPreferences();

    // Aplicado no momento do parse, nao no DOMContentLoaded: assim a pagina ja
    // nasce com o tema escolhido em vez de trocar de cor na frente do usuario.
    function applyPreferences() {
        const root = document.documentElement;

        root.style.fontSize = FONT_SCALES[preferences.fonte] || FONT_SCALES.padrao;

        if (preferences.contraste === 'alto') {
            root.setAttribute('data-contrast', 'alto');
        } else {
            root.removeAttribute('data-contrast');
        }

        if (preferences.movimento === 'reduzido') {
            root.setAttribute('data-motion', 'reduzido');
        } else {
            root.removeAttribute('data-motion');
        }
    }

    applyPreferences();

    function update(key, value) {
        preferences = {
            ...preferences,
            [key]: value,
            // Marca a escolha como do usuario: a partir daqui, a adaptacao
            // automatica por deficiencia nao mexe mais nesta preferencia.
            definidoPeloUsuario: { ...preferences.definidoPeloUsuario, [key]: true }
        };
        savePreferences(preferences);
        applyPreferences();
        syncButtons();
        announce(key, value);
    }

    /**
     * Aplica o conjunto de ajustes correspondente ao tipo de deficiencia do
     * paciente logado. Chamada pelo dashboard depois de carregar o perfil.
     *
     * @param {string} tipoDeDeficiencia valor de `pacientes.tipo_deficiencia`
     * @returns {object|null} o perfil aplicado, ou null se nao houver
     */
    function aplicarPerfilDeDeficiencia(tipoDeDeficiencia) {
        const chave = perfilParaTipoDeDeficiencia(tipoDeDeficiencia);
        const root = document.documentElement;

        if (!chave) {
            root.removeAttribute('data-adaptacao');
            return null;
        }

        const perfil = PERFIS_DE_ADAPTACAO[chave];

        // O marcador no <html> e o que liga as regras de CSS do perfil
        // (espacamento, tamanho de alvo, densidade).
        root.setAttribute('data-adaptacao', chave);

        const sugeridas = {};
        Object.entries(perfil.preferencias).forEach(([campo, valor]) => {
            if (!preferences.definidoPeloUsuario[campo]) {
                sugeridas[campo] = valor;
            }
        });

        if (Object.keys(sugeridas).length) {
            preferences = { ...preferences, ...sugeridas };
            savePreferences(preferences);
            applyPreferences();
            syncButtons();
        }

        return { chave, ...perfil, aplicadas: sugeridas };
    }

    window.ConectaAcessibilidade = {
        aplicarPerfilDeDeficiencia,
        perfilParaTipoDeDeficiencia,
        PERFIS_DE_ADAPTACAO
    };

    let panel;
    let launcher;
    let liveRegion;

    const LABELS = {
        fonte: {
            padrao: 'tamanho de fonte padrao',
            medio: 'fonte ampliada',
            grande: 'fonte muito ampliada'
        },
        contraste: {
            normal: 'contraste padrao',
            alto: 'alto contraste ativado'
        },
        movimento: {
            normal: 'animacoes ativadas',
            reduzido: 'animacoes reduzidas'
        }
    };

    function announce(key, value) {
        if (!liveRegion) return;
        liveRegion.textContent = LABELS[key]?.[value] || '';
    }

    function syncButtons() {
        if (!panel) return;
        panel.querySelectorAll('.a11y-option').forEach((button) => {
            const isActive = preferences[button.dataset.pref] === button.dataset.value;
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    function buildPanel() {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <button type="button" class="a11y-launcher" id="a11yLauncher"
                    aria-expanded="false" aria-controls="a11yPanel">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="7.4" r="1.4" fill="currentColor" stroke="none"/>
                    <path d="M7 10.2h10M12 10.6V16M12 13.4l-2.2 3.6M12 13.4l2.2 3.6"/>
                </svg>
                <span>Acessibilidade</span>
            </button>

            <section class="a11y-panel" id="a11yPanel" role="dialog"
                     aria-labelledby="a11yPanelTitle" hidden>
                <div class="a11y-panel-header">
                    <div>
                        <h2 id="a11yPanelTitle">Preferencias de leitura</h2>
                        <p>Suas escolhas ficam salvas neste navegador.</p>
                    </div>
                    <button type="button" class="a11y-close" id="a11yClose" aria-label="Fechar preferencias">&times;</button>
                </div>

                <div class="a11y-group">
                    <span id="a11yFonteLabel">Tamanho do texto</span>
                    <div class="a11y-options" role="group" aria-labelledby="a11yFonteLabel">
                        <button type="button" class="a11y-option" data-pref="fonte" data-value="padrao" style="font-size:0.85rem">A</button>
                        <button type="button" class="a11y-option" data-pref="fonte" data-value="medio" style="font-size:1rem">A</button>
                        <button type="button" class="a11y-option" data-pref="fonte" data-value="grande" style="font-size:1.2rem">A</button>
                    </div>
                </div>

                <div class="a11y-group">
                    <span id="a11yContrasteLabel">Contraste</span>
                    <div class="a11y-options" role="group" aria-labelledby="a11yContrasteLabel">
                        <button type="button" class="a11y-option" data-pref="contraste" data-value="normal">Padrao</button>
                        <button type="button" class="a11y-option" data-pref="contraste" data-value="alto">Alto</button>
                    </div>
                </div>

                <div class="a11y-group">
                    <span id="a11yMovimentoLabel">Animacoes</span>
                    <div class="a11y-options" role="group" aria-labelledby="a11yMovimentoLabel">
                        <button type="button" class="a11y-option" data-pref="movimento" data-value="normal">Normais</button>
                        <button type="button" class="a11y-option" data-pref="movimento" data-value="reduzido">Reduzidas</button>
                    </div>
                </div>

                <button type="button" class="a11y-reset" id="a11yReset">Restaurar padrao</button>
                <p class="sr-only" id="a11yLive" role="status" aria-live="polite"></p>
            </section>
        `;

        // `while` em vez de appendChild(wrapper): evita uma div extra no body,
        // que atrapalharia seletores das telas que usam `body > *`.
        while (wrapper.firstElementChild) {
            document.body.appendChild(wrapper.firstElementChild);
        }

        launcher = document.getElementById('a11yLauncher');
        panel = document.getElementById('a11yPanel');
        liveRegion = document.getElementById('a11yLive');

        launcher.addEventListener('click', togglePanel);
        document.getElementById('a11yClose').addEventListener('click', () => closePanel(true));
        document.getElementById('a11yReset').addEventListener('click', () => {
            // "Restaurar padrao" tambem esquece quais preferencias foram
            // ajustadas a mao - senao a adaptacao por deficiencia continuaria
            // bloqueada para sempre depois do primeiro clique no painel.
            preferences = { ...defaults, definidoPeloUsuario: {} };
            savePreferences(preferences);
            applyPreferences();
            syncButtons();
            announce('contraste', 'normal');

            // Volta a valer a sugestao do perfil, se houver uma ativa.
            const adaptacaoAtual = document.documentElement.getAttribute('data-adaptacao');
            if (adaptacaoAtual && PERFIS_DE_ADAPTACAO[adaptacaoAtual]) {
                preferences = { ...preferences, ...PERFIS_DE_ADAPTACAO[adaptacaoAtual].preferencias };
                savePreferences(preferences);
                applyPreferences();
                syncButtons();
            }
        });

        panel.querySelectorAll('.a11y-option').forEach((button) => {
            button.addEventListener('click', () => update(button.dataset.pref, button.dataset.value));
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !panel.hidden) {
                closePanel(true);
            }
        });

        document.addEventListener('click', (event) => {
            if (panel.hidden) return;
            if (panel.contains(event.target) || launcher.contains(event.target)) return;
            closePanel(false);
        });

        syncButtons();
    }

    function togglePanel() {
        if (panel.hidden) {
            panel.hidden = false;
            launcher.setAttribute('aria-expanded', 'true');
            panel.querySelector('.a11y-option').focus();
        } else {
            closePanel(true);
        }
    }

    function closePanel(returnFocus) {
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        if (returnFocus) {
            launcher.focus();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildPanel);
    } else {
        buildPanel();
    }
})();
