-- Conecta Inclusao - schema PostgreSQL (Neon)
-- Este e o schema canonico da aplicacao. O arquivo antigo era MySQL e nao
-- correspondia ao banco realmente usado pela API (src/db.js usa o driver `pg`).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS responsavel (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    status SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pacientes (
    id SERIAL PRIMARY KEY,
    nome_paciente VARCHAR(100) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    tipo_deficiencia VARCHAR(100),
    data_nascimento DATE,
    senha VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_responsavel INTEGER,
    CONSTRAINT fk_pacientes_responsavel FOREIGN KEY (id_responsavel) REFERENCES responsavel(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinicas (
    id SERIAL PRIMARY KEY,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    nome VARCHAR(100) NOT NULL,
    razao_social VARCHAR(100),
    endereco VARCHAR(255),
    cidade VARCHAR(100),
    estado VARCHAR(2),
    cep VARCHAR(10),
    telefone VARCHAR(15),
    responsavel VARCHAR(100),
    senha VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicos (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    crm VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    especialidade VARCHAR(100),
    unidade VARCHAR(20) NOT NULL,
    clinica_id INTEGER,
    bio TEXT,
    senha VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP NULL,
    must_change_password BOOLEAN DEFAULT FALSE,
    temporary_password_token VARCHAR(255) NULL,
    temporary_password_expires_at TIMESTAMP NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_clinica_id FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agendamentos (
    id SERIAL PRIMARY KEY,
    clinica_id INTEGER NOT NULL,
    paciente_id INTEGER NOT NULL,
    medico_id INTEGER NOT NULL,
    data_agendamento TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente',
    CONSTRAINT fk_agendamento_clinica FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE,
    CONSTRAINT fk_agendamento_paciente FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
    CONSTRAINT fk_agendamento_medico FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relatorios (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER NOT NULL,
    descricao TEXT NOT NULL,
    prescricao TEXT,
    data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_relatorios_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    profile VARCHAR(20) NOT NULL,
    profile_id INTEGER NOT NULL,
    data TEXT,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS mensagens (
    id BIGSERIAL PRIMARY KEY,
    agendamento_id INTEGER NOT NULL,
    remetente_profile VARCHAR(20) NOT NULL,
    remetente_profile_id INTEGER NOT NULL,
    conteudo TEXT NOT NULL,
    lida BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mensagens_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paciente_responsavel (
    id_paciente INTEGER NOT NULL,
    id_responsavel INTEGER NOT NULL,
    PRIMARY KEY (id_paciente, id_responsavel),
    CONSTRAINT fk_paciente_responsavel_paciente FOREIGN KEY (id_paciente) REFERENCES pacientes(id) ON DELETE CASCADE,
    CONSTRAINT fk_paciente_responsavel_responsavel FOREIGN KEY (id_responsavel) REFERENCES responsavel(id) ON DELETE CASCADE,
    parentesco VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS permissoes (
    id SERIAL PRIMARY KEY,
    -- UNIQUE e o que faz o ON CONFLICT DO NOTHING do seed abaixo funcionar.
    -- Sem ele, cada execucao do script inseria as 3 permissoes de novo (o banco
    -- atual ficou com 12 linhas por conta disso).
    nome VARCHAR(200) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS responsavel_permissoes (
    id_permissao INTEGER NOT NULL,
    id_responsavel INTEGER NOT NULL,
    PRIMARY KEY (id_permissao, id_responsavel),
    CONSTRAINT fk_responsavel_id FOREIGN KEY (id_responsavel) REFERENCES responsavel(id) ON DELETE CASCADE,
    CONSTRAINT fk_permissao_id FOREIGN KEY (id_permissao) REFERENCES permissoes(id) ON DELETE CASCADE
);

INSERT INTO permissoes (nome) VALUES
    ('Ver agendamentos'),
    ('Enviar mensagens'),
    ('Gerenciar agendamentos')
ON CONFLICT (nome) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Indices de apoio
--
-- Os tokens de recuperacao passaram a ser guardados como SHA-256 do token
-- sorteado (e nao mais bcrypt), justamente para permitir busca por igualdade
-- indexada. Antes a API varria todas as linhas com token pendente e rodava um
-- bcrypt.compare por linha, o que dava um DoS barato.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pacientes_password_reset_token ON pacientes (password_reset_token);
CREATE INDEX IF NOT EXISTS idx_medicos_password_reset_token ON medicos (password_reset_token);
CREATE INDEX IF NOT EXISTS idx_clinicas_password_reset_token ON clinicas (password_reset_token);

CREATE INDEX IF NOT EXISTS idx_agendamentos_paciente ON agendamentos (paciente_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_medico ON agendamentos (medico_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_clinica ON agendamentos (clinica_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_agendamento ON mensagens (agendamento_id, created_at);
CREATE INDEX IF NOT EXISTS idx_medicos_clinica ON medicos (clinica_id);

-- ---------------------------------------------------------------------------
-- Alteracoes incrementais
--
-- Este bloco e seguro de rodar em banco que ja tem dados: todo comando usa
-- IF NOT EXISTS, entao reexecutar o arquivo inteiro nao quebra nada.
-- ---------------------------------------------------------------------------

-- O responsavel passa a ter CPF proprio. Serve para dois fins:
--   1. login do responsavel por CPF (antes so era possivel por e-mail);
--   2. identificar a mesma pessoa quando ela e responsavel por mais de um
--      paciente - nesse caso reaproveitamos a linha existente em vez de criar
--      um responsavel duplicado, e so acrescentamos o vinculo em
--      paciente_responsavel.
ALTER TABLE responsavel ADD COLUMN IF NOT EXISTS cpf VARCHAR(14);

-- UNIQUE via indice parcial: as linhas antigas ficam com cpf NULL e nao podem
-- colidir entre si. (Em Postgres varios NULL ja convivem num UNIQUE comum, mas
-- o WHERE deixa a intencao explicita.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_responsavel_cpf
    ON responsavel (cpf)
    WHERE cpf IS NOT NULL;

-- A PK de paciente_responsavel e (id_paciente, id_responsavel), o que so
-- indexa buscas que comecam pelo paciente. O login do responsavel faz o
-- caminho inverso - "quais pacientes essa pessoa acompanha" - entao precisa
-- de indice proprio por id_responsavel.
CREATE INDEX IF NOT EXISTS idx_paciente_responsavel_responsavel
    ON paciente_responsavel (id_responsavel);

-- Campos novos do perfil do paciente (aba "Meu Perfil" passou a ser editavel).
-- Nao existe coluna de plano de saude aqui e isso e proposital: o campo foi
-- removido do cadastro.
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS telefone VARCHAR(20);
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS unidade_preferencia VARCHAR(120);

-- ---------------------------------------------------------------------------
-- Unidades (filiais) da clinica
--
-- Ate aqui "unidade" era uma string solta: o formulario de cadastro de medico
-- oferecia "Unidade A/B/C" fixas no HTML e gravava o texto em medicos.unidade.
-- Sem endereco nao havia como responder a pergunta que a clinica realmente faz
-- no momento do cadastro - "qual das minhas unidades fica mais perto desse
-- medico?".
--
-- latitude/longitude sao preenchidas por geocodificacao (Nominatim/OSM) a
-- partir do CEP no momento do cadastro da unidade. NUMERIC(9,6) cobre a
-- precisao util de ~10 cm, bem mais do que o necessario aqui.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidades (
    id SERIAL PRIMARY KEY,
    clinica_id INTEGER NOT NULL,
    nome VARCHAR(120) NOT NULL,
    cep VARCHAR(10),
    logradouro VARCHAR(255),
    numero VARCHAR(20),
    bairro VARCHAR(120),
    cidade VARCHAR(120),
    estado VARCHAR(2),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_unidades_clinica FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE
);

-- Duas unidades da mesma clinica nao podem ter o mesmo nome: o nome e o que
-- aparece na combobox e o que continua sendo gravado em medicos.unidade.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_clinica_nome
    ON unidades (clinica_id, LOWER(nome));

CREATE INDEX IF NOT EXISTS idx_unidades_clinica ON unidades (clinica_id);

-- ---------------------------------------------------------------------------
-- Endereco e coordenadas do medico
--
-- Alimentados pelo CEP no cadastro (ViaCEP -> Nominatim). Servem para ordenar
-- as unidades por distancia e, no caso de `estado`, para validar a UF do CRM.
-- ---------------------------------------------------------------------------
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS cep VARCHAR(10);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS logradouro VARCHAR(255);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS numero VARCHAR(20);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS bairro VARCHAR(120);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS cidade VARCHAR(120);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS estado VARCHAR(2);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6);
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

-- UF do conselho. Fica separada de `crm` de proposito: `crm` continua sendo o
-- identificador de login (so o numero), entao mudar o formato dele quebraria o
-- acesso de todo medico ja cadastrado. A exibicao "CRM/SP 123456" e montada
-- juntando as duas colunas.
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS crm_uf VARCHAR(2);

-- Vinculo com a unidade escolhida. medicos.unidade (texto) continua preenchido
-- para nao quebrar as telas e filtros que leem essa coluna.
ALTER TABLE medicos ADD COLUMN IF NOT EXISTS unidade_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_medicos_unidade'
    ) THEN
        ALTER TABLE medicos
            ADD CONSTRAINT fk_medicos_unidade
            FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medicos_unidade ON medicos (unidade_id);

-- ---------------------------------------------------------------------------
-- Agendamento duplicado
--
-- Nada impedia o mesmo paciente de marcar duas vezes com o mesmo medico no
-- mesmo horario: a rota de agendamento do paciente nao fazia checagem nenhuma
-- e o servico so olhava conflito de agenda do medico com OUTROS pacientes.
-- O indice parcial resolve na raiz - inclusive em duas requisicoes simultaneas,
-- que uma checagem em SELECT antes do INSERT nao pega.
--
-- Consultas canceladas ficam de fora: depois de cancelar, o paciente precisa
-- poder remarcar o mesmo horario.
--
-- ATENCAO: se o banco JA tiver duplicatas gravadas, a criacao do indice falha
-- ("could not create unique index"). Rode a consulta abaixo antes para ver se
-- ha algo a limpar:
--
--   SELECT paciente_id, medico_id, data_agendamento, COUNT(*), ARRAY_AGG(id)
--   FROM agendamentos
--   WHERE status <> 'cancelado'
--   GROUP BY paciente_id, medico_id, data_agendamento
--   HAVING COUNT(*) > 1;
--
-- Para cada grupo devolvido, mantenha o menor id e cancele os demais:
--
--   UPDATE agendamentos SET status = 'cancelado' WHERE id IN (<ids extras>);
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_sem_duplicata
    ON agendamentos (paciente_id, medico_id, data_agendamento)
    WHERE status <> 'cancelado';

-- Consulta de horarios livres do medico num dia: filtra por medico e faixa de
-- data_agendamento.
CREATE INDEX IF NOT EXISTS idx_agendamentos_medico_data
    ON agendamentos (medico_id, data_agendamento);
