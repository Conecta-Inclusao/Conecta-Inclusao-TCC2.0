-- 1. Criar o Banco de Dados
CREATE DATABASE IF NOT EXISTS conecta_inclusao;
USE conecta_inclusao;

-- 2. Tabela de Pacientes (Informações do responsável e PCD)
CREATE TABLE pacientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome_paciente VARCHAR(100) NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    nome_responsavel VARCHAR(100),
    tipo_deficiencia VARCHAR(100),
    plano_atual VARCHAR(100),
    data_nascimento DATE,
    senha VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt da senha',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabela de Clínicas/Empresas (Detalhes das empresas)
CREATE TABLE clinicas (
    id INT AUTO_INCREMENT PRIMARY KEY,
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
    senha VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt da senha',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabela de Médicos (Detalhes profissionais)
CREATE TABLE medicos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    crm VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    especialidade VARCHAR(100),
    unidade VARCHAR(20) NOT NULL,
    clinica_id INT,
    bio TEXT,
    senha VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt da senha',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    failed_attempts INT DEFAULT 0,
    locked_until DATETIME NULL,
    must_change_password BOOLEAN DEFAULT FALSE,
    temporary_password_token VARCHAR(255) NULL,
    temporary_password_expires_at DATETIME NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE SET NULL
);

-- 5. Tabela de Agendamentos (Consultas)
CREATE TABLE agendamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    clinica_id INT NOT NULL,
    paciente_id INT NOT NULL,
    medico_id INT NOT NULL,
    data_agendamento DATETIME NOT NULL,
    status ENUM('pendente', 'confirmado', 'cancelado', 'realizado') DEFAULT 'pendente',
    link_reuniao VARCHAR(255), -- Para a consulta online
    FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE,
    FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
    FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE
);

-- 6. Tabela de Responsáveis e vínculo com pacientes
CREATE TABLE responsavel (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt da senha',
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

CREATE TABLE paciente_responsavel (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_paciente INT NOT NULL,
    id_responsavel INT NOT NULL,
    parentesco VARCHAR(100) NOT NULL,
    FOREIGN KEY (id_paciente) REFERENCES pacientes(id) ON DELETE CASCADE,
    FOREIGN KEY (id_responsavel) REFERENCES responsavel(id) ON DELETE CASCADE
);

-- 7. Tabela de Relatórios Médicos (Histórico e Registros)
CREATE TABLE relatorios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agendamento_id INT NOT NULL,
    descricao TEXT NOT NULL,
    prescricao TEXT,
    data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
);

-- 7. Tabela de Sessões (Para armazenar sessões de usuário no banco)
CREATE TABLE sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    profile ENUM('paciente', 'medico', 'clinica') NOT NULL,
    profile_id INT NOT NULL,
    data TEXT,
    expires_at DATETIME NOT NULL
);

-- 8. Tabela de Mensagens
-- Garante que a conversa fique vinculada a um mesmo atendimento/agendamento
-- e possa ser validada por RBAC entre paciente e medico relacionados.
CREATE TABLE mensagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agendamento_id INT NOT NULL,
    remetente_profile ENUM('paciente', 'medico') NOT NULL,
    remetente_profile_id INT NOT NULL,
    destinatario_profile ENUM('paciente', 'medico') NOT NULL,
    destinatario_profile_id INT NOT NULL,
    conteudo TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
);