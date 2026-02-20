const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, '.env');

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }

        const equalIndex = trimmed.indexOf('=');
        if (equalIndex <= 0) {
            return;
        }

        const key = trimmed.slice(0, equalIndex).trim();
        let value = trimmed.slice(equalIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    });
}

loadEnv(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const ARK_API_URL = process.env.ARK_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/responses';
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215';
const ARK_IMAGE_API_URL = process.env.ARK_IMAGE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const ARK_IMAGE_MODEL = process.env.ARK_IMAGE_MODEL || 'doubao-seedream-4-5-251128';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) {
                reject(new Error('请求体过大'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error('请求体不是合法 JSON'));
            }
        });
        req.on('error', reject);
    });
}

async function handleTextProxy(req, res) {
    if (!ARK_API_KEY) {
        sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
        return;
    }

    try {
        const body = await readJsonBody(req);
        const messages = body.messages;

        if (!Array.isArray(messages) || messages.length === 0) {
            sendJson(res, 400, { error: 'messages 不能为空' });
            return;
        }

        const response = await axios.post(
            ARK_API_URL,
            {
                model: ARK_MODEL,
                input: messages
            },
            {
                headers: {
                    Authorization: `Bearer ${ARK_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        sendJson(res, 200, response.data);
    } catch (error) {
        const status = error.response?.status || 500;
        const detail = error.response?.data || error.message;
        sendJson(res, status, {
            error: '文本代理请求失败',
            detail
        });
    }
}

async function handleImageProxy(req, res) {
    if (!ARK_API_KEY) {
        sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
        return;
    }

    try {
        const body = await readJsonBody(req);
        const prompt = (body.prompt || '').trim();
        if (!prompt) {
            sendJson(res, 400, { error: 'prompt 不能为空' });
            return;
        }

        const response = await axios.post(
            ARK_IMAGE_API_URL,
            {
                model: ARK_IMAGE_MODEL,
                prompt,
                sequential_image_generation: 'disabled',
                response_format: 'url',
                size: body.size || '2K',
                stream: false,
                watermark: body.watermark !== false
            },
            {
                headers: {
                    Authorization: `Bearer ${ARK_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        sendJson(res, 200, response.data);
    } catch (error) {
        const status = error.response?.status || 500;
        const detail = error.response?.data || error.message;
        sendJson(res, status, {
            error: '图像代理请求失败',
            detail
        });
    }
}

function serveStatic(req, res) {
    const requestPath = req.url.split('?')[0];
    const relativePath = requestPath === '/' ? '/product-generator-orange.html' : requestPath;
    const normalizedPath = path.normalize(relativePath).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(ROOT_DIR, normalizedPath);

    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
        });
        res.end(data);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS' && (req.url === '/api/text' || req.url === '/api/image')) {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/text') {
        await handleTextProxy(req, res);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/image') {
        await handleImageProxy(req, res);
        return;
    }

    if (req.method === 'GET') {
        serveStatic(req, res);
        return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
