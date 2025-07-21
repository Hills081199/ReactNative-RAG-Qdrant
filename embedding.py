import os
import uuid
import fitz  # PyMuPDF
import requests
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams
from qdrant_client.http.exceptions import UnexpectedResponse

import dotenv

dotenv.load_dotenv()
QDRANT_URL = os.getenv('QDRANT_URL')
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION')
QDRANT_API_KEY = os.getenv('QDRANT_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)

def create_collection():
    print(f'Checking collection: {QDRANT_COLLECTION}')
    try:
        # Try to delete existing collection if it exists
        qdrant.delete_collection(collection_name=QDRANT_COLLECTION)
        print(f"Deleted existing collection '{QDRANT_COLLECTION}'")
    except Exception as e:
        print(f"Could not delete collection (might not exist): {e}")
    
    # Create new collection with 1536 dimensions
    print(f'Creating new collection: {QDRANT_COLLECTION} with vector size 1536')
    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
    )

def embed_text_openai(text):
    headers = {
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json'
    }
    data = {
        "input": text,
        "model": "text-embedding-3-small"
    }
    response = requests.post('https://api.openai.com/v1/embeddings', headers=headers, json=data)
    response.raise_for_status()
    embedding = response.json()['data'][0]['embedding']
    print(f"Generated embedding with {len(embedding)} dimensions")  # Should print 1536
    return embedding

def split_text(text, chunk_size=500):
    sentences = [line.strip() for line in text.split('\n') if line.strip()]
    chunks = []
    current = ''

    for sentence in sentences:
        if len(current + sentence) < chunk_size * 4:
            current += sentence + ' '
        else:
            chunks.append(current.strip())
            current = sentence + ' '

    if current:
        chunks.append(current.strip())
    return chunks

def process_pdf_to_qdrant(file_path):
    doc = fitz.open(file_path)
    full_text = ''
    for page in doc:
        full_text += page.get_text()

    chunks = split_text(full_text, 500)

    vectors = []
    for chunk in chunks:
        print('Embedding chunk:', chunk[:100])
        vector = embed_text_openai(chunk)
        vectors.append({
            'id': str(uuid.uuid4()),
            'vector': vector,
            'payload': {'text': chunk}
        })

    qdrant.upsert(collection_name=QDRANT_COLLECTION, points=vectors)
    print(f'Đã upsert {len(vectors)} chunks vào Qdrant.')

if __name__ == '__main__':
    create_collection()
    file_path = './MYCV.pdf'
    process_pdf_to_qdrant(file_path)