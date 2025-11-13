// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // Permite acesso do seu frontend
app.use(express.json({ limit: '50mb' })); // Permite JSON e aumenta o limite para as fotos em base64


// O Pool lê automaticamente a variável de ambiente 'DATABASE_URL' no Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões no Render
  }
});

// SUBSTITUA A FUNÇÃO 'toCamelCase' ANTIGA POR ESTA:

// Função helper para converter snake_case (DB) para camelCase (JS)
const toCamelCase = (rows) => {
    return rows.map(row => {
        const newRow = {};
        for (const key in row) {
            // [CORREÇÃO] Regex ajustado para funcionar corretamente
            const camelKey = key.replace(/_(\w)/g, (match, p1) => p1.toUpperCase());
            newRow[camelKey] = row[key];
        }
        return newRow;
    });
};

// ------ 🚀 INÍCIO DAS ROTAS DA API 🚀 ------

/**
 * @route GET /api/atividades-importadas
 * @desc Busca todas as atividades "modelo" (do Excel).
 */
app.get('/api/atividades-importadas', async (req, res) => {
    try {
        // [MODIFICADO] { rows } e sem '?'
        const { rows } = await pool.query('SELECT * FROM atividades_importadas ORDER BY id');
        res.json(toCamelCase(rows));
    } catch (error) {
        console.error('Erro em /api/atividades-importadas:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

// SUBSTITUA A ROTA 'POST /api/atividades-importadas' PELA VERSÃO ABAIXO

/**
 * @route POST /api/atividades-importadas
 * @desc Salva (substitui) a lista de atividades "modelo".
 */
app.post('/api/atividades-importadas', async (req, res) => {
    const { activities } = req.body;
    // [MODIFICADO] 'pg' usa 'client' para transações
    const client = await pool.connect(); 

    try {
        await client.query('BEGIN'); // Inicia a transação

        await client.query('DELETE FROM atividades_importadas');
        // [MODIFICADO] Sintaxe do Postgres para resetar ID
        await client.query('ALTER SEQUENCE atividades_importadas_id_seq RESTART WITH 1');

        const query = `
            INSERT INTO atividades_importadas 
            (tempo_previsto, proc_id, evento, acao, criterios_aceitacao) 
            VALUES ($1, $2, $3, $4, $5)
        `;
        for (const act of activities) {
            // [MODIFICADO] Placeholders $1, $2...
            await client.query(query, [
                act['T + (hh:mm)'],
                act['Proc. ID'],
                act['Event'],
                act['Event / Action'],
                act['Key Acceptance Criteria']
            ]);
        }

        await client.query('COMMIT'); // Confirma as mudanças
        res.status(201).json({ message: `${activities.length} atividades importadas.` });

    } catch (error) {
        console.error('Erro em POST /api/atividades-importadas:', error);
        await client.query('ROLLBACK'); // Desfaz em caso de erro
        res.status(500).json({ error: 'Erro de servidor ao importar. A operação foi desfeita.' });
    } finally {
        client.release(); // Libera o cliente de volta ao pool
    }
});

// SUBSTITUA A ROTA 'DELETE /api/atividades-importadas' PELA VERSÃO ABAIXO

/**
 * @route DELETE /api/atividades-importadas
 * @desc Limpa TODAS as atividades modelo (do Excel) e reseta o ID.
 */
app.delete('/api/atividades-importadas', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM atividades_importadas');
        await client.query('ALTER SEQUENCE atividades_importadas_id_seq RESTART WITH 1');
        await client.query('COMMIT');

        console.log('Tabela "atividades_importadas" foi limpa e resetada.');
        res.status(200).json({ message: 'Tabela de atividades importadas limpa.' });

    } catch (error) {
        console.error('Erro em DELETE /api/atividades-importadas:', error);
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro de servidor ao limpar atividades.' });
    } finally {
        client.release();
    }
});


/**
 * @route GET /api/turno-ativo
 * @desc Busca o turno com status 'ativo', se houver, e suas tarefas.
 */
app.get('/api/turno-ativo', async (req, res) => {
    try {
        // [MODIFICADO] Sintaxe $1 e { rows }
        const { rows: turnos } = await pool.query('SELECT * FROM turnos WHERE status = $1', ['ativo']);
        
        if (turnos.length === 0) {
            return res.json(null);
        }

        const turnoAtivo = toCamelCase(turnos)[0];
        
        // [MODIFICADO] Sintaxe $1 e CAST
        const { rows: tarefas } = await pool.query(
            `SELECT * FROM tarefas_execucao WHERE turno_instance_id = $1 
             ORDER BY CAST(SUBSTRING(task_id FROM '([0-9]+)$') AS INTEGER)`, // Regex PG para ordenar
            [turnoAtivo.instanceId]
        );
        const tarefasCamel = toCamelCase(tarefas);

        for (let tarefa of tarefasCamel) {
            // [MODIFICADO] Sintaxe $1 e { rows }
            const { rows: fotos } = await pool.query(
                'SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = $1', 
                [tarefa.taskId]
            );
            tarefa.photos = fotos.map(f => f.base64); 
        }
        
        turnoAtivo.tasks = tarefasCamel;
        res.json(turnoAtivo);

    } catch (error) {
        console.error('Erro em /api/turno-ativo:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/turnos/iniciar
 * @desc Cria um novo turno e todas as suas tarefas baseadas nas atividades-modelo.
 */
app.post('/api/turnos/iniciar', async (req, res) => {
    const { operator, shiftStart, ditlTotalSeconds } = req.body;
    const instanceId = `INST-${Date.now()}`;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // [MODIFICADO] $1, $2, $3, $4
        await client.query(
            'INSERT INTO turnos (instance_id, operador_responsavel, inicio_turno, status) VALUES ($1, $2, $3, $4)',
            [instanceId, operator, new Date(shiftStart), 'ativo']
        );

        // [MODIFICADO] { rows }
        const { rows: atividades } = await client.query('SELECT * FROM atividades_importadas ORDER BY id');
        
        const queryTarefa = `
            INSERT INTO tarefas_execucao 
            (task_id, turno_instance_id, proc_id, acao, status, time_mode, target_seconds) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        
        let taskCounter = 1;
        for (const act of atividades) {
            const taskId = `TASK-${instanceId.split('-')[1]}-${taskCounter}`;
            const targetSeconds = timeToTotalSeconds(act.tempo_previsto);
            
            // [MODIFICADO] $1...$7
            await client.query(queryTarefa, [
                taskId,
                instanceId,
                act.proc_id,
                act.acao,
                'pendente',
                'countdown',
                targetSeconds
            ]);
            taskCounter++;
        }

        await client.query('COMMIT');
        res.status(201).json({ instanceId: instanceId });

    } catch (error) {
        console.error('Erro em /api/turnos/iniciar:', error);
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro de servidor' });
    } finally {
        client.release();
    }
});

/**
 * @route POST /api/turnos/:id/encerrar
 * @desc Marca um turno como 'concluido'.
 */
app.post('/api/turnos/:id/encerrar', async (req, res) => {
    try {
        const { id } = req.params;
        const { shiftEnd } = req.body;

        // [MODIFICADO] $1, $2, $3
        await pool.query(
            'UPDATE turnos SET status = $1, fim_turno = $2 WHERE instance_id = $3',
            ['concluido', new Date(shiftEnd), id]
        );
        res.json({ message: 'Turno encerrado' });
    } catch (error) {
        console.error('Erro em /api/turnos/:id/encerrar:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/tarefa/:id/atualizar-status
 * @desc Atualiza o status e o runtime de uma tarefa (usado para PAUSE).
 */
app.post('/api/tarefa/:id/atualizar-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, runtimeSeconds } = req.body;

        // [MODIFICADO] $1, $2, $3
        await pool.query(
            'UPDATE tarefas_execucao SET status = $1, runtime_seconds = $2 WHERE task_id = $3',
            [status, runtimeSeconds, id]
        );
        res.json({ message: 'Status atualizado' });
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/atualizar-status:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route POST /api/tarefa/:id/completar
 * @desc Completa uma tarefa (SUCESSO ou FALHA) e salva evidências.
 */
app.post('/api/tarefa/:id/completar', async (req, res) => {
    const { id } = req.params;
    const { success, operatorTask, observation, completedAt, runtimeSeconds, photos } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // [MODIFICADO] $1...$8
        await client.query(
            `UPDATE tarefas_execucao 
             SET status = $1, success = $2, operador_tarefa = $3, observacao = $4, 
                 completed = TRUE, completed_at = $5, runtime_seconds = $6
             WHERE task_id = $7`,
            [
                success ? 'concluido' : 'falha',
                success,
                operatorTask,
                observation,
                new Date(completedAt),
                runtimeSeconds,
                id
            ]
        );
        
        // [MODIFICADO] $1
        await client.query('DELETE FROM evidencias_fotos WHERE task_id = $1', [id]);
        
        for (let base64Img of photos) {
            // [MODIFICADO] $1, $2
            await client.query(
                'INSERT INTO evidencias_fotos (task_id, imagem_base64) VALUES ($1, $2)',
                [id, base64Img]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Tarefa completada' });
        
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/completar:', error);
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro de servidor' });
    } finally {
        client.release();
    }
});

/**
 * @route POST /api/tarefa/:id/reiniciar
 * @desc Reseta uma tarefa para o estado inicial.
 */
app.post('/api/tarefa/:id/reiniciar', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
        
    try {
        await client.query('BEGIN');

        // [MODIFICADO] $1
        // (Nota: No Postgres, 'NULL' não precisa de 'SET')
        await client.query(
            `UPDATE tarefas_execucao 
             SET status = 'pendente', runtime_seconds = 0, operador_tarefa = NULL, 
                 observacao = NULL, completed = FALSE, completed_at = NULL, success = NULL
             WHERE task_id = $1`,
            [id]
        );
        
        // [MODIFICADO] $1
        await client.query('DELETE FROM evidencias_fotos WHERE task_id = $1', [id]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Tarefa reiniciada' });
        
    } catch (error) {
        console.error('Erro em /api/tarefa/:id/reiniciar:', error);
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro de servidor' });
    } finally {
        client.release();
    }
});

/**
 * @route GET /api/relatorios
 * @desc Busca todos os turnos (para a aba de relatórios).
 */
app.get('/api/relatorios', async (req, res) => {
    try {
        // [MODIFICADO] { rows }
        const { rows: turnos } = await pool.query(
            'SELECT * FROM turnos ORDER BY inicio_turno DESC'
        );
        
        const turnosCamel = toCamelCase(turnos);

        for (let turno of turnosCamel) {
            // [MODIFICADO] $1 e { rows }
            // (Nota: SUM no PG retorna um tipo 'bigint' que o JS lê como string,
            // então usamos '::INTEGER' para converter)
            const { rows: stats } = await pool.query(
                `SELECT COUNT(*) AS total, SUM(CASE WHEN completed THEN 1 ELSE 0 END)::INTEGER AS done 
                 FROM tarefas_execucao 
                 WHERE turno_instance_id = $1`,
                [turno.instanceId]
            );
            turno.tasksTotal = stats[0].total || 0;
            turno.tasksDone = stats[0].done || 0;
        }
        res.json(turnosCamel);

    } catch (error) {
        console.error('Erro em /api/relatorios:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});

/**
 * @route GET /api/relatorio/:id
 * @desc Busca dados completos de UM turno (para o preview do PDF).
 */
app.get('/api/relatorio/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // [MODIFICADO] $1 e { rows }
        const { rows: turnos } = await pool.query('SELECT * FROM turnos WHERE instance_id = $1', [id]);
        
        if (turnos.length === 0) {
            return res.status(404).json({ error: 'Relatório não encontrado' });
        }
        
        const turno = toCamelCase(turnos)[0];
        
        // [MODIFICADO] $1 e CAST
        const { rows: tarefas } = await pool.query(
            `SELECT * FROM tarefas_execucao WHERE turno_instance_id = $1 
             ORDER BY CAST(SUBSTRING(task_id FROM '([0-9]+)$') AS INTEGER)`,
            [turno.instanceId]
        );
        const tarefasCamel = toCamelCase(tarefas);

        for (let tarefa of tarefasCamel) {
            // [MODIFICADO] $1 e { rows }
            const { rows: fotos } = await pool.query(
                'SELECT imagem_base64 AS base64 FROM evidencias_fotos WHERE task_id = $1', 
                [tarefa.taskId]
            );
            tarefa.photos = fotos.map(f => f.base64); 
            
            // [MODIFICADO] $1 e { rows }
            const { rows: modelo } = await pool.query(
                'SELECT acao, criterios_aceitacao, proc_id FROM atividades_importadas WHERE proc_id = $1',
                [tarefa.procId]
            );
            if(modelo.length > 0) {
                tarefa['Event / Action'] = modelo[0].acao;
                tarefa['Key Acceptance Criteria'] = modelo[0].criterios_aceitacao;
                tarefa['Proc. ID'] = modelo[0].proc_id;
            }
        }
        
        turno.tasks = tarefasCamel;
        res.json(turno);

    } catch (error) {
        console.error('Erro em /api/relatorio/:id:', error);
        res.status(500).json({ error: 'Erro de servidor' });
    }
});


// ------ 🚀 FIM DAS ROTAS DA API 🚀 ------

// Função helper (copiada do seu script.js)
function timeToTotalSeconds(timeStr) {
    if (!timeStr) return 0;
    const matches = timeStr.match(/(\d{2}):(\d{2})/g);
    if (!matches) return 0;
    const lastTimeStr = matches[matches.length - 1]; 
    const parts = lastTimeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
        const hours = parts[0];
        const minutes = parts[1];
        const totalSeconds = (hours * 3600) + (minutes * 60);
        return isNaN(totalSeconds) ? 0 : totalSeconds;
    }
    return 0;
}

// Inicia o servidor
app.listen(port, () => {
    console.log(`🚀 Backend DITL rodando na porta ${port}`);
});