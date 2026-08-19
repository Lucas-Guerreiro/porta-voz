import os
import sqlite3
import json
import queue
import threading
from datetime import datetime
from flask import Flask, request, jsonify, Response, g

app = Flask(__name__, static_folder='static', static_url_path='/static')
DATABASE = 'denuncias.db'

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

# SQLite Connection helpers
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the SQLite database with the required schema."""
    if not os.path.exists(DATABASE):
        # Create database file
        open(DATABASE, 'w').close()
        
    with app.app_context():
        db = get_db()
        db.execute('''
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
        data_ocorrencia = data['data_ocorrencia']
        detalhes = data.get('detalhes', '').strip()
        data_envio = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Insert into DB
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO denuncias (descricao, tipo, data_ocorrencia, local, detalhes, anonimo, nome, contato, status, data_envio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Nova', ?)
        ''', (descricao, data['tipo'], data_ocorrencia, data['local'], detalhes, anonimo, nome, contato, data_envio))
        db.commit()
        
        denuncia_id = cursor.lastrowid
        
        # Retrieve the newly created denuncia to broadcast and return
        cursor.execute('SELECT * FROM denuncias WHERE id = ?', (denuncia_id,))
        row = cursor.fetchone()
        
        denuncia_dict = dict(row)
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
        filter_anonimo = request.args.get('anonimo') # 'true'/'false' or '1'/'0'
        filter_data = request.args.get('data') # YYYY-MM-DD
        
        query = 'SELECT * FROM denuncias WHERE 1=1'
        params = []
        
        if filter_id:
            query += ' AND id = ?'
            params.append(filter_id)
        if filter_tipo:
            query += ' AND tipo = ?'
            params.append(filter_tipo)
        if filter_local:
            query += ' AND local = ?'
            params.append(filter_local)
        if filter_status:
            query += ' AND status = ?'
            params.append(filter_status)
        if filter_anonimo is not None:
            anon_val = 1 if filter_anonimo.lower() in ['true', '1'] else 0
            query += ' AND anonimo = ?'
            params.append(anon_val)
        if filter_data:
            query += ' AND data_ocorrencia = ?'
            params.append(filter_data)
            
        # Order by newest submission date
        query += ' ORDER BY data_envio DESC'
        
        db = get_db()
        rows = db.execute(query, params).fetchall()
        
        result = []
        for r in rows:
            d = dict(r)
            d['anonimo'] = bool(d['anonimo'])
            result.append(d)
            
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias/<int:denuncia_id>', methods=['GET'])
def get_denuncia_by_id(denuncia_id):
    try:
        db = get_db()
        row = db.execute('SELECT * FROM denuncias WHERE id = ?', (denuncia_id,)).fetchone()
        
        if not row:
            return jsonify({"error": f"Denúncia com ID {denuncia_id} não encontrada"}), 404
            
        denuncia_dict = dict(row)
        denuncia_dict['anonimo'] = bool(denuncia_dict['anonimo'])
        return jsonify(denuncia_dict), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

@app.route('/api/denuncias/<int:denuncia_id>/publica', methods=['GET'])
def get_public_denuncia_by_id(denuncia_id):
    try:
        db = get_db()
        # Safe projection: excludes name, contact and detail descriptions
        row = db.execute('SELECT id, tipo, local, data_ocorrencia, data_envio, status, descricao FROM denuncias WHERE id = ?', (denuncia_id,)).fetchone()
        
        if not row:
            return jsonify({"error": f"Denúncia com protocolo #{denuncia_id:04d} não encontrada"}), 404
            
        denuncia_dict = dict(row)
        return jsonify(denuncia_dict), 200
        
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
        cursor.execute('UPDATE denuncias SET status = ? WHERE id = ?', (status, denuncia_id))
        
        if cursor.rowcount == 0:
            return jsonify({"error": f"Denúncia com ID {denuncia_id} não encontrada"}), 404
            
        db.commit()
        
        # Fetch updated record
        cursor.execute('SELECT * FROM denuncias WHERE id = ?', (denuncia_id,))
        row = cursor.fetchone()
        
        denuncia_dict = dict(row)
        denuncia_dict['anonimo'] = bool(denuncia_dict['anonimo'])
        
        # Broadcast status change event via SSE so admin dashboard updates instantly
        announce_sse_event('status_atualizado', denuncia_dict)
        
        return jsonify(denuncia_dict), 200
        
    except Exception as e:
        return jsonify({"error": f"Erro interno no servidor: {str(e)}"}), 500

# Server-Sent Events (SSE) endpoint
@app.route('/api/sse')
def sse_endpoint():
    def event_generator():
        q = queue.Queue()
        with sse_lock:
            sse_listeners.append(q)
            
        # Send initial setup ping
        yield f"data: {json.dumps({'type': 'ping', 'message': 'Conexão estabelecida com sucesso'})}\n\n"
        
        try:
            while True:
                # Blocks until a new message is posted to the queue
                event_data = q.get()
                yield f"data: {json.dumps(event_data)}\n\n"
        except GeneratorExit:
            # Client disconnected
            with sse_lock:
                if q in sse_listeners:
                    sse_listeners.remove(q)
                    
    return Response(event_generator(), mimetype='text/event-stream')

if __name__ == '__main__':
    init_db()
    # Runs the Flask server on port 5000 (accessible on localhost)
    app.run(host='0.0.0.0', port=5000, debug=True)
