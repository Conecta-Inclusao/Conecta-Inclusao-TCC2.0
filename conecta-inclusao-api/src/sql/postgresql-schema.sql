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
  failed_attempts INT DEFAULT 0,
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
  failed_attempts INT DEFAULT 0,
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
  failed_attempts INT DEFAULT 0,
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
  nome VARCHAR(200) NOT NULL
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
ON CONFLICT DO NOTHING;