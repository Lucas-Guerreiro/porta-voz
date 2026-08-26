import os
import sqlite3
import json
import queue
import threading
from datetime import datetime
from flask import Flask, request, jsonify, Response, g

app = Flask(__name__, static_folder='static', static_url_path='/static')

# Cloud PostgreSQL Configuration
DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    # Replaces deprecated postgres:// prefix with postgresql:// for compatibility with psycopg2
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

DATABASE_SQLITE = 'denuncias.db'

# SSE Thread-safe broadcasting mechanism
sse_listeners = []
sse_lock = threading.Lock()

def announce_sse_event(event_type, data):
    """Broadcasts an event to all connected SSE clients."""
    payload = {
        "type": event_type,
        "timestamp": datetime.now().isoformat(),
        "data": data
    }
    with sse_lock:
        for q in list(sse_listeners):
            try:
                q.put(payload)
            except Exception:
                sse_listeners.remove(q)

# Dynamic DB Connection helpers
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        if DATABASE_URL:
            import psycopg2
            db = g._database = psycopg2.connect(DATABASE_URL)
        else:
            db = g._database = sqlite3.connect(DATABASE_SQLITE)
            db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Database-agnostic Query Helpers
def get_placeholder():
    """Returns %s for PostgreSQL and ? for SQLite."""
    return '%s' if DATABASE_URL else '?'

def fetch_all_as_dict(cursor):
    """Maps cursor rows to list of dictionaries."""
    rows = cursor.fetchall()
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in rows]

def fetch_one_as_dict(cursor):
    """Maps a single cursor row to a dictionary."""
    row = cursor.fetchone()
    if not row:
        return None
    columns = [col[0] for col in cursor.description]
    return dict(zip(columns, row))

def init_db():
    """Initializes the database table with standard SQLite or PostgreSQL schemas."""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        if DATABASE_URL:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS denuncias (
                    id SERIAL PRIMARY KEY,
                    descricao TEXT NOT NULL,
                    tipo TEXT NOT NULL,
                    data_ocorrencia TEXT NOT NULL,
                    local TEXT NOT NULL,
                    detalhes TEXT,
                    anonimo INTEGER NOT NULL,
                    nome TEXT,
                    contato TEXT,
                    status TEXT NOT NULL DEFAULT 'Nova',
                    data_envio TEXT NOT NULL
                )
            ''')
            db.commit()
        else:
            if not os.path.exists(DATABASE_SQLITE):
                open(DATABASE_SQLITE, 'w').close()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS denuncias (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    descricao TEXT NOT NULL,
                    tipo TEXT NOT NULL,
                    data_ocorrencia TEXT NOT NULL,
                    local TEXT NOT NULL,
                    detalhes TEXT,
                    anonimo INTEGER NOT NULL,
                    nome TEXT,
                    contato TEXT,
                    status TEXT NOT NULL DEFAULT 'Nova',
                    data_envio TEXT NOT NULL
                )
            ''')
            db.commit()

# Route definitions for Static Files
@app.route('/')
def route_index():
    return app.send_static_file('index.html')

@app.route('/admin')
def route_admin():
    return app.send_static_file('admin.html')

# API Endpoints
@app.route('/api/denuncias', methods=['POST'])
def create_denuncia():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Dados inválidos ou corpo da requisição vazio"}), 400
        
        # Validation
        required_fields = ['descricao', 'tipo', 'data_ocorrencia', 'local', 'anonimo']
        for field in required_fields:
            if field not in data or data[field] is None:
                return jsonify({"error": f"O campo '{field}' é obrigatório"}), 400
        
        # Valid options checks
        allowed_tipos = [
            'Bullying', 'Cyberbullying', 'Assédio sexual', 'Assédio moral', 
            'Agressão física', 'Agressão verbal', 'Ameaça', 'Preconceito/discriminação', 
            'Furto', 'Outro'
        ]
        allowed_locais = [
            'Pátio', 'Quadra', 'Salão Jovem', 'Sala de aula', 
            'Banheiro', 'Corredor', 'Entrada/saída', 'Outro'
        ]
        
        if data['tipo'] not in allowed_tipos:
            return jsonify({"error": "Tipo de ocorrência inválido"}), 400
        if data['local'] not in allowed_locais:
            return jsonify({"error": "Local de ocorrência inválido"}), 400
            
        anonimo = 1 if data['anonimo'] else 0
        nome = None
        contato = None
        
        if not anonimo:
            if 'nome' not in data or not data['nome'].strip():
                return jsonify({"error": "Nome é obrigatório para denúncias identificadas"}), 400
            if 'contato' not in data or not data['contato'].strip():
                return jsonify({"error": "Contato é obrigatório para denúncias identificadas"}), 400
            nome = data['nome'].strip()
            contato = data['contato'].strip()
            
        descricao = data['descricao'].strip()
        if len(descricao) > 15:
            return jsonify({"error": "A descrição resumida deve ter no máximo 15 caracteres"}), 400
        data_ocorrencia = data['data_ocorrencia']
        detalhes = data.get('detalhes', '').strip()
        data_envio = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Insert into DB
        db = get_db()
        cursor = db.cursor()
        p = get_placeholder()
        
        if DATABASE_URL:
            # Postgres INSERT returning the SERIAL generated ID
            cursor.execute(f'''
                INSERT INTO denuncias (descricao, tipo, data_ocorrencia, local, detalhes, anonimo, nome, contato, status, data_envio)
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, 'Nova', {p})
                RETURNING id
            ''', (descricao, data['tipo'], data_ocorrencia, data['local'], detalhes, anonimo, nome, contato, data_envio))
            denuncia_id = cursor.fetchone()[0]
        else:
            # SQLite INSERT
            cursor.execute(f'''
                INSERT INTO denuncias (descricao, tipo, data_ocorrencia, local, detalhes, anonimo, nome, contato, status, data_envio)
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, 'Nova', {p})
            ''', (descricao, data['tipo'], data_ocorrencia, data['local'], detalhes, anonimo, nome, contato, data_envio))
            denuncia_id = cursor.lastrowid
            
        db.commit()
        
        # Retrieve the newly created row using DB-agnostic helper
        cursor.execute(f'SELECT * FROM denuncias WHERE id = {p}', (denuncia_id,))
        denuncia_dict = fetch_one_as_dict(cursor)
        
        # Convert numeric boolean
        denuncia_dict['anonimo'] = bool(denuncia_dict['anonimo'])
        
        # Broadcast via SSE
        announce_sse_event('nova_denuncia', denuncia_dict)
        
        return jsonify(denuncia_dict), 201
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias', methods=['GET'])
def get_denuncias():
    try:
        # Extract filters
        filter_id = request.args.get('id')
        filter_tipo = request.args.get('tipo')
        filter_local = request.args.get('local')
        filter_status = request.args.get('status')
        filter_anonimo = request.args.get('anonimo')
        filter_data = request.args.get('data')
        
        query = 'SELECT * FROM denuncias WHERE 1=1'
        params = []
        p = get_placeholder()
        
        if filter_id:
            query += f' AND id = {p}'
            params.append(int(filter_id) if filter_id.isdigit() else 0)
        if filter_tipo:
            query += f' AND tipo = {p}'
            params.append(filter_tipo)
        if filter_local:
            query += f' AND local = {p}'
            params.append(filter_local)
        if filter_status:
            query += f' AND status = {p}'
            params.append(filter_status)
        if filter_anonimo is not None:
            anon_val = 1 if filter_anonimo.lower() in ['true', '1'] else 0
            query += f' AND anonimo = {p}'
            params.append(anon_val)
        if filter_data:
            query += f' AND data_ocorrencia = {p}'
            params.append(filter_data)
            
        # Order by newest submission date
        query += ' ORDER BY data_envio DESC'
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute(query, params)
        rows = fetch_all_as_dict(cursor)
        
        result = []
        for d in rows:
            d['anonimo'] = bool(d['anonimo'])
            result.append(d)
            
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias/<int:denuncia_id>', methods=['GET'])
def get_denuncia_by_id(denuncia_id):
    try:
        db = get_db()
        cursor = db.cursor()
        p = get_placeholder()
        cursor.execute(f'SELECT * FROM denuncias WHERE id = {p}', (denuncia_id,))
        row = fetch_one_as_dict(cursor)
        
        if not row:
            return jsonify({"error": f"Denúncia com ID {denuncia_id} não encontrada"}), 404
            
        row['anonimo'] = bool(row['anonimo'])
        return jsonify(row), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias/<int:denuncia_id>/publica', methods=['GET'])
def get_public_denuncia_by_id(denuncia_id):
    try:
        db = get_db()
        cursor = db.cursor()
        p = get_placeholder()
        
        # Safe projection excludes reporter identity details
        cursor.execute(f'SELECT id, tipo, local, data_ocorrencia, data_envio, status, descricao FROM denuncias WHERE id = {p}', (denuncia_id,))
        row = fetch_one_as_dict(cursor)
        
        if not row:
            return jsonify({"error": f"Denúncia com protocolo #{denuncia_id:04d} não encontrada"}), 404
            
        return jsonify(row), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias/<int:denuncia_id>/status', methods=['PATCH'])
def update_denuncia_status(denuncia_id):
    try:
        data = request.get_json()
        if not data or 'status' not in data:
            return jsonify({"error": "Status não fornecido"}), 400
            
        status = data['status'].strip()
        allowed_statuses = ['Nova', 'Em análise', 'Em atendimento', 'Resolvida', 'Arquivada']
        if status not in allowed_statuses:
            return jsonify({"error": "Status inválido"}), 400
            
        db = get_db()
        cursor = db.cursor()
        p = get_placeholder()
        cursor.execute(f'UPDATE denuncias SET status = {p} WHERE id = {p}', (status, denuncia_id))
        db.commit()
        
        # Fetch updated record
        cursor.execute(f'SELECT * FROM denuncias WHERE id = {p}', (denuncia_id,))
        row = fetch_one_as_dict(cursor)
        
        if not row:
            return jsonify({"error": f"Denúncia com ID {denuncia_id} não encontrada"}), 404
            
        row['anonimo'] = bool(row['anonimo'])
        
        # Broadcast status change event via SSE
        announce_sse_event('status_atualizado', row)
        
        return jsonify(row), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "database": "postgres" if DATABASE_URL else "sqlite",
        "realtime": not DATABASE_URL
    }), 200

# Server-Sent Events (SSE) endpoint
@app.route('/api/sse')
def sse_endpoint():
    def event_generator():
        q = queue.Queue()
        with sse_lock:
            sse_listeners.append(q)
            
        yield f"data: {json.dumps({'type': 'ping', 'message': 'Conexão estabelecida com sucesso'})}\n\n"
        
        try:
            while True:
                event_data = q.get()
                yield f"data: {json.dumps(event_data)}\n\n"
        except GeneratorExit:
            with sse_lock:
                if q in sse_listeners:
                    sse_listeners.remove(q)
                    
    return Response(event_generator(), mimetype='text/event-stream')

# Initialize DB on import
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
