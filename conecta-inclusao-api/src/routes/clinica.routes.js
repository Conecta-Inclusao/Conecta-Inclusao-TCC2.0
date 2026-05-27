import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createClinicSchema } from "../validators/clinica.validators.js";
import {
    createClinica,
    getClinicaById,
    listClinicas,
    updateClinica,
    validateCNPJ
} from "../services/clinica.service.js";

const router = Router();

const clinicaCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false
});

router.post("/register", clinicaCreateLimiter, async (req, res, next) => {
    try {
        const parsed = createClinicSchema.safeParse(req.body);

        if (!parsed.success) {
            const errors = parsed.error.flatten().fieldErrors;
            const errorMessages = {};

            for (const [field, messages] of Object.entries(errors)) {
                errorMessages[field] = messages[0];
            }

            return res.status(400).json({
                ok: false,
                message: "Dados invalidos",
                errors: errorMessages
            });
        }

        if (!validateCNPJ(parsed.data.cnpj)) {
            return res.status(400).json({
                ok: false,
                message: "CNPJ invalido",
                field: "cnpj"
            });
        }

        const result = await createClinica(parsed.data);

        if (!result.ok) {
            return res.status(result.statusCode).json({
                ok: false,
                message: result.message
            });
        }

        return res.status(result.statusCode).json(result);
    } catch (err) {
        next(err);
    }
});

router.get("/", async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
        const offset = parseInt(req.query.offset, 10) || 0;
        const result = await listClinicas(limit, offset);

        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const clinicaId = parseInt(req.params.id, 10);

        if (Number.isNaN(clinicaId)) {
            return res.status(400).json({
                ok: false,
                message: "ID de clinica invalido"
            });
        }

        const result = await getClinicaById(clinicaId);

        if (!result.ok) {
            return res.status(result.statusCode).json({
                ok: false,
                message: result.message
            });
        }

        return res.status(200).json({
            ok: true,
            data: result.data
        });
    } catch (err) {
        next(err);
    }
});

router.put("/:id", async (req, res, next) => {
    try {
        const clinicaId = parseInt(req.params.id, 10);

        if (Number.isNaN(clinicaId)) {
            return res.status(400).json({
                ok: false,
                message: "ID de clinica invalido"
            });
        }

        const result = await updateClinica(clinicaId, req.body);

        if (!result.ok) {
            return res.status(result.statusCode).json({
                ok: false,
                message: result.message
            });
        }

        return res.status(200).json(result);
    } catch (err) {
        next(err);
    }
});

export default router;
