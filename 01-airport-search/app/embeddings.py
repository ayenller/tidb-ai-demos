"""Text -> vector. Any OpenAI-compatible endpoint; swap the base URL for
Azure, Together, SiliconFlow, a local vLLM, whatever you run."""
import os
from functools import lru_cache

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
DIM = int(os.getenv("EMBEDDING_DIM", "1536"))


@lru_cache(maxsize=1)
def _client() -> OpenAI:
    return OpenAI(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )


def embed(texts: list[str]) -> list[list[float]]:
    """Batch-embed. Keep batches <= ~256 items to stay under request limits."""
    out: list[list[float]] = []
    for i in range(0, len(texts), 128):
        chunk = texts[i : i + 128]
        resp = _client().embeddings.create(model=MODEL, input=chunk)
        out.extend(d.embedding for d in resp.data)
    return out


@lru_cache(maxsize=2048)
def embed_one(text: str) -> tuple[float, ...]:
    """Cached single embedding — the demo re-queries the same strings a lot."""
    return tuple(embed([text])[0])


def to_sql_vector(vec) -> str:
    """TiDB accepts a vector literal as a JSON-ish string: '[0.1,-0.2,...]'."""
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"
