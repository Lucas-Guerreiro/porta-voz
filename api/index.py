import os
import sys

# Ensure the root folder is in the Python path for Vercel Serverless Functions
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.append(root_dir)

from app import app
