import unittest
import json
import os
import tempfile
import sqlite3
from app import app, init_db, DATABASE_SQLITE

class PortaVozTestCase(unittest.TestCase):
    def setUp(self):
        # Set up a temporary database file
        self.db_fd, self.db_path = tempfile.mkstemp()
        app.config['DATABASE'] = self.db_path
        
        # Override the global DATABASE_SQLITE variable inside app.py
        import app as app_module
        self.original_db_path = app_module.DATABASE_SQLITE
        app_module.DATABASE_SQLITE = self.db_path
        
        app.config['TESTING'] = True
        self.client = app.test_client()
        
        # Initialize schema
        init_db()

    def tearDown(self):
        # Close database descriptor and remove file
        os.close(self.db_fd)
        os.unlink(self.db_path)
        
        # Restore original database path variable
        import app as app_module
        app_module.DATABASE_SQLITE = self.original_db_path

    def test_database_initialization(self):
        """Test that the sqlite3 database initializes with correct table structure."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Check that table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='denuncias';")
        self.assertIsNotNone(cursor.fetchone())
        
        # Check column names
        cursor.execute("PRAGMA table_info(denuncias);")
        columns = [col[1] for col in cursor.fetchall()]
        self.assertIn("id", columns)
        self.assertIn("descricao", columns)
        self.assertIn("tipo", columns)
        self.assertIn("data_ocorrencia", columns)
        self.assertIn("local", columns)
        self.assertIn("detalhes", columns)
        self.assertIn("anonimo", columns)
        self.assertIn("nome", columns)
        self.assertIn("contato", columns)
        self.assertIn("status", columns)
        self.assertIn("data_envio", columns)
        conn.close()

    def test_create_anonymous_denuncia(self):
        """Test sending a valid anonymous report with short description."""
        payload = {
            "descricao": "Bullying pátio",  # 14 chars (under 15 limit)
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "detalhes": "Dois alunos do 9º ano estavam provocando um aluno menor.",
            "anonimo": True
        }
        
        response = self.client.post('/api/denuncias', 
                                   data=json.dumps(payload),
                                   content_type='application/json')
        
        self.assertEqual(response.status_code, 201)
        data = json.loads(response.data)
        
        self.assertIn("id", data)
        self.assertEqual(data["descricao"], payload["descricao"])
        self.assertEqual(data["tipo"], payload["tipo"])
        self.assertEqual(data["data_ocorrencia"], payload["data_ocorrencia"])
        self.assertEqual(data["local"], payload["local"])
        self.assertEqual(data["detalhes"], payload["detalhes"])
        self.assertEqual(data["anonimo"], True)
        self.assertIsNone(data["nome"])
        self.assertIsNone(data["contato"])
        self.assertEqual(data["status"], "Nova")
        self.assertIn("data_envio", data)

    def test_create_identified_denuncia(self):
        """Test sending a valid identified report."""
        payload = {
            "descricao": "Agressão verbal",  # 15 chars
            "tipo": "Agressão verbal",
            "data_ocorrencia": "2026-08-18",
            "local": "Corredor",
            "detalhes": "Insultos verbais repetidos na troca de salas.",
            "anonimo": False,
            "nome": "Carlos Souza",
            "contato": "carlos.souza@email.com"
        }
        
        response = self.client.post('/api/denuncias', 
                                   data=json.dumps(payload),
                                   content_type='application/json')
        
        self.assertEqual(response.status_code, 201)
        data = json.loads(response.data)
        
        self.assertEqual(data["anonimo"], False)
        self.assertEqual(data["nome"], "Carlos Souza")
        self.assertEqual(data["contato"], "carlos.souza@email.com")

    def test_create_denuncia_validation_errors(self):
        """Test validation rules for missing fields and bad choices."""
        # 1. Missing description
        payload = {
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "anonimo": True
        }
        response = self.client.post('/api/denuncias', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn("descricao", json.loads(response.data)["error"])

        # 2. Invalid type
        payload = {
            "descricao": "Tipo inválido",
            "tipo": "TipoInexistente",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "anonimo": True
        }
        response = self.client.post('/api/denuncias', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn("Tipo de ocorrência inválido", json.loads(response.data)["error"])

        # 3. Missing contact info for identified report
        payload = {
            "descricao": "Agressão",
            "tipo": "Agressão verbal",
            "data_ocorrencia": "2026-08-18",
            "local": "Corredor",
            "anonimo": False,
            "nome": "Carlos"
            # Missing contact
        }
        response = self.client.post('/api/denuncias', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn("Contato é obrigatório", json.loads(response.data)["error"])

        # 4. Description too long (over 15 characters)
        payload = {
            "descricao": "Texto com mais de quinze caracteres de comprimento.", # 51 chars
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "anonimo": True
        }
        response = self.client.post('/api/denuncias', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn("máximo 15 caracteres", json.loads(response.data)["error"])

    def test_get_denuncias_and_filtering(self):
        """Test retrieving all reports and verifying filter parameters."""
        d1 = {
            "descricao": "Bullying",
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "anonimo": True
        }
        d2 = {
            "descricao": "Furto",
            "tipo": "Furto",
            "data_ocorrencia": "2026-08-15",
            "local": "Sala de aula",
            "anonimo": False,
            "nome": "Lucas",
            "contato": "9999-9999"
        }
        
        self.client.post('/api/denuncias', data=json.dumps(d1), content_type='application/json')
        self.client.post('/api/denuncias', data=json.dumps(d2), content_type='application/json')

        # Get all
        response = self.client.get('/api/denuncias')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(len(data), 2)

        # Filter by type
        response = self.client.get('/api/denuncias?tipo=Bullying')
        data = json.loads(response.data)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["tipo"], "Bullying")

        # Filter by local
        response = self.client.get('/api/denuncias?local=Sala de aula')
        data = json.loads(response.data)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["local"], "Sala de aula")

        # Filter by anonymity
        response = self.client.get('/api/denuncias?anonimo=true')
        data = json.loads(response.data)
        self.assertEqual(len(data), 1)
        self.assertTrue(data[0]["anonimo"])

    def test_update_status(self):
        """Test status transitions."""
        d = {
            "descricao": "Bullying",
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "anonimo": True
        }
        res = self.client.post('/api/denuncias', data=json.dumps(d), content_type='application/json')
        inserted_id = json.loads(res.data)["id"]

        # Initial status check
        res = self.client.get(f'/api/denuncias/{inserted_id}')
        self.assertEqual(json.loads(res.data)["status"], "Nova")

        # Change to Em análise
        res = self.client.patch(f'/api/denuncias/{inserted_id}/status', 
                                data=json.dumps({"status": "Em análise"}),
                                content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(json.loads(res.data)["status"], "Em análise")

        # Verify change persisted
        res = self.client.get(f'/api/denuncias/{inserted_id}')
        self.assertEqual(json.loads(res.data)["status"], "Em análise")

        # Try changing to invalid status
        res = self.client.patch(f'/api/denuncias/{inserted_id}/status', 
                                data=json.dumps({"status": "InvalidStatusName"}),
                                content_type='application/json')
        self.assertEqual(res.status_code, 400)

    def test_get_public_denuncia_by_id(self):
        """Test retrieving a report through the secure public tracking route."""
        d = {
            "descricao": "Bullying",
            "tipo": "Bullying",
            "data_ocorrencia": "2026-08-19",
            "local": "Pátio",
            "detalhes": "Dois alunos do 9º ano estavam provocando.",
            "anonimo": False,
            "nome": "Lucas Santos",
            "contato": "lucas@email.com"
        }
        res = self.client.post('/api/denuncias', data=json.dumps(d), content_type='application/json')
        inserted_id = json.loads(res.data)["id"]

        # Call public safe endpoint
        response = self.client.get(f'/api/denuncias/{inserted_id}/publica')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)

        # Verify safe projection contains basic details
        self.assertEqual(data["id"], inserted_id)
        self.assertEqual(data["tipo"], d["tipo"])
        self.assertEqual(data["local"], d["local"])
        self.assertEqual(data["data_ocorrencia"], d["data_ocorrencia"])
        self.assertEqual(data["status"], "Nova")
        self.assertEqual(data["descricao"], d["descricao"])

        # Verify that personal data is NOT exposed
        self.assertNotIn("nome", data)
        self.assertNotIn("contato", data)
        self.assertNotIn("detalhes", data)

        # Test non-existing protocol lookup
        response = self.client.get('/api/denuncias/99999/publica')
        self.assertEqual(response.status_code, 404)
        self.assertIn("error", json.loads(response.data))

if __name__ == '__main__':
    unittest.main()
