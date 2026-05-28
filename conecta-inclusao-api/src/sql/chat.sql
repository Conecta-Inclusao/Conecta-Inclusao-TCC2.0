CREATE TABLE IF NOT EXISTS mensagens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agendamento_id INT NOT NULL,
    remetente_profile ENUM(
        'paciente',
        'medico',
        'responsavel',
        'clinica'
    ) NOT NULL,
    remetente_profile_id INT NOT NULL,
    conteudo TEXT NOT NULL,
    lida BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agendamento_id)
        REFERENCES agendamentos(id)
        ON DELETE CASCADE
);

-- Use somente se seu banco local ainda estiver com a versao antiga da tabela:
-- ALTER TABLE mensagens DROP COLUMN destinatario_profile;
-- ALTER TABLE mensagens DROP COLUMN destinatario_profile_id;
-- ALTER TABLE mensagens MODIFY COLUMN remetente_profile ENUM('paciente', 'medico', 'responsavel', 'clinica') NOT NULL;
-- ALTER TABLE mensagens ADD COLUMN lida BOOLEAN DEFAULT FALSE AFTER conteudo;
