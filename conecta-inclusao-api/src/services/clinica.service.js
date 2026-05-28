import { pool } from "../db.js";
import { hashPassword } from "./auth.service.js";

export function validateCNPJ(cnpj) {
    const cleanCNPJ = String(cnpj || '').replace(/\D/g, '');

    if (cleanCNPJ.length !== 14) return false;
    if (cleanCNPJ === cleanCNPJ[0].repeat(14)) return false;

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(cleanCNPJ[i], 10) * (5 - (i % 4));
    }

    let remainder = sum % 11;
    remainder = remainder < 2 ? 0 : 11 - remainder;
    if (remainder !== parseInt(cleanCNPJ[12], 10)) return false;

    sum = 0;
    for (let i = 0; i < 13; i++) {
        sum += parseInt(cleanCNPJ[i], 10) * (6 - ((i + 1) % 5));
    }

    remainder = sum % 11;
    remainder = remainder < 2 ? 0 : 11 - remainder;

    return remainder === parseInt(cleanCNPJ[13], 10);
}

export function validateCPF(cpf) {
    const cleanCPF = String(cpf || '').replace(/\D/g, '');

    if (cleanCPF.length !== 11) return false;
    if (cleanCPF === cleanCPF[0].repeat(11)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(cleanCPF[i], 10) * (10 - i);
    }

    let remainder = (sum * 10) % 11;
    remainder = remainder === 10 || remainder === 11 ? 0 : remainder;
    if (remainder !== parseInt(cleanCPF[9], 10)) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(cleanCPF[i], 10) * (11 - i);
    }

    remainder = (sum * 10) % 11;
    remainder = remainder === 10 || remainder === 11 ? 0 : remainder;

    return remainder === parseInt(cleanCPF[10], 10);
}

function clinicPayload(data) {
    const addressParts = [
        data.address || data.endereco,
        data.number || data.numero,
        data.complement || data.complemento
    ].filter(Boolean);

    return {
        nome: data.clinicName || data.name,
        cnpj: String(data.cnpj || '').replace(/\D/g, ''),
        email: data.clinicEmail || data.email || null,
        razao_social: data.razaoSocial || data.razao_social || data.companyLegalName || data.clinicName || data.name,
        endereco: addressParts.join(', ') || data.endereco || null,
        cidade: data.city || data.cidade || null,
        estado: data.state || data.estado || null,
        cep: String(data.cep || '').replace(/\D/g, '') || null,
        telefone: String(data.clinicPhone || data.telefone || '').replace(/\D/g, '') || null,
        responsavel: data.responsibleName || data.responsavel || null
    };
}

export async function createClinica(data) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const payload = clinicPayload(data);

        const [existingCNPJ] = await connection.query(
            "SELECT id FROM clinicas WHERE cnpj = ? LIMIT 1",
            [payload.cnpj]
        );

        if (existingCNPJ.length > 0) {
            await connection.rollback();
            return { ok: false, statusCode: 409, message: "CNPJ ja cadastrado no sistema" };
        }

        if (payload.email) {
            const [existingEmail] = await connection.query(
                "SELECT id FROM clinicas WHERE email = ? LIMIT 1",
                [payload.email]
            );

            if (existingEmail.length > 0) {
                await connection.rollback();
                return { ok: false, statusCode: 409, message: "Email ja cadastrado no sistema" };
            }
        }

        const passwordHash = await hashPassword(data.password);
        if (!passwordHash.ok) {
            await connection.rollback();
            return { ok: false, statusCode: 400, message: passwordHash.error };
        }

        const [result] = await connection.query(
            `INSERT INTO clinicas
             (nome, cnpj, email, razao_social, endereco, cidade, estado, cep, telefone, responsavel, senha, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
            [
                payload.nome,
                payload.cnpj,
                payload.email,
                payload.razao_social,
                payload.endereco,
                payload.cidade,
                payload.estado,
                payload.cep,
                payload.telefone,
                payload.responsavel,
                passwordHash.hash
            ]
        );

        await connection.commit();

        return {
            ok: true,
            statusCode: 201,
            message: "Clinica cadastrada com sucesso",
            data: {
                clinic: { id: result.insertId, ...payload },
                identifier: payload.cnpj
            }
        };
    } catch (err) {
        await connection.rollback();
        console.error("Erro ao criar clinica:", err);
        return { ok: false, statusCode: 500, message: "Erro interno do servidor ao criar clinica" };
    } finally {
        connection.release();
    }
}

export async function getClinicaById(clinicaId) {
    try {
        const [rows] = await pool.query(
            `SELECT id, cnpj, email, nome, razao_social, endereco, cidade, estado, cep,
                    telefone, responsavel, status, created_at
             FROM clinicas
             WHERE id = ?
             LIMIT 1`,
            [clinicaId]
        );

        if (rows.length === 0) {
            return { ok: false, statusCode: 404, message: "Clinica nao encontrada" };
        }

        return { ok: true, data: rows[0] };
    } catch (err) {
        console.error("Erro ao obter clinica:", err);
        return { ok: false, statusCode: 500, message: "Erro ao obter clinica" };
    }
}

export async function listClinicas(limit = 10, offset = 0) {
    try {
        const [rows] = await pool.query(
            `SELECT id, cnpj, email, nome, razao_social, endereco, cidade, estado, cep,
                    telefone, responsavel, status, created_at
             FROM clinicas
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        const [countResult] = await pool.query("SELECT COUNT(*) as total FROM clinicas");

        return {
            ok: true,
            data: rows,
            total: countResult[0].total,
            limit,
            offset
        };
    } catch (err) {
        console.error("Erro ao listar clinicas:", err);
        return { ok: false, statusCode: 500, message: "Erro ao listar clinicas" };
    }
}

export async function updateClinica(clinicaId, data) {
    try {
        const updateFields = [];
        const updateValues = [];
        const writableFields = {
            clinicName: ["nome", (value) => value],
            name: ["nome", (value) => value],
            clinicEmail: ["email", (value) => value || null],
            email: ["email", (value) => value || null],
            clinicPhone: ["telefone", (value) => String(value || '').replace(/\D/g, '') || null],
            telefone: ["telefone", (value) => String(value || '').replace(/\D/g, '') || null],
            razaoSocial: ["razao_social", (value) => value || null],
            razao_social: ["razao_social", (value) => value || null],
            address: ["endereco", (value) => value || null],
            endereco: ["endereco", (value) => value || null],
            city: ["cidade", (value) => value || null],
            cidade: ["cidade", (value) => value || null],
            state: ["estado", (value) => value || null],
            estado: ["estado", (value) => value || null],
            cep: ["cep", (value) => String(value || '').replace(/\D/g, '') || null],
            responsibleName: ["responsavel", (value) => value || null],
            responsavel: ["responsavel", (value) => value || null]
        };

        const usedColumns = new Set();
        for (const [key, value] of Object.entries(data || {})) {
            const field = writableFields[key];
            if (!field || usedColumns.has(field[0])) continue;

            updateFields.push(`${field[0]} = ?`);
            updateValues.push(field[1](value));
            usedColumns.add(field[0]);
        }

        if (updateFields.length === 0) {
            return { ok: false, statusCode: 400, message: "Nenhum campo para atualizar" };
        }

        updateValues.push(clinicaId);

        const [result] = await pool.query(
            `UPDATE clinicas SET ${updateFields.join(", ")} WHERE id = ?`,
            updateValues
        );

        if (result.affectedRows === 0) {
            return { ok: false, statusCode: 404, message: "Clinica nao encontrada" };
        }

        return { ok: true, message: "Clinica atualizada com sucesso" };
    } catch (err) {
        console.error("Erro ao atualizar clinica:", err);
        return { ok: false, statusCode: 500, message: "Erro ao atualizar clinica" };
    }
}
