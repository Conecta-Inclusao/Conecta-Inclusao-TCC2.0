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
