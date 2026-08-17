from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .assistant import router as assistant_router
from .auth_routes import router as auth_router
from .config import DATA
from .db import ensure_storage, init_db
from .projects import router as projects_router
from .references import router as references_router
from .settings import router as settings_router
from .templates import router as templates_router

ensure_storage()

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Ecom Visual Studio API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(projects_router)
app.include_router(templates_router)
app.include_router(references_router)
app.include_router(assistant_router)
app.mount("/files", StaticFiles(directory=DATA), name="files")
