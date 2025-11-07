from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import UserCreate, UserLogin, Token, User, AnalyzeRequest, WorkflowGraph
from auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    check_rate_limit,
    users_db
)
from gemini_client import gemini_client
from analyzer import static_analyzer
import json

app = FastAPI(title="AI Workflow Visualizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/auth/register", response_model=Token)
async def register(user: UserCreate):
    if user.email in users_db:
        raise HTTPException(status_code=400, detail="Email already registered")

    users_db[user.email] = {
        "email": user.email,
        "hashed_password": get_password_hash(user.password),
        "is_paid": False,
        "requests_today": 0,
        "last_request_date": None
    }

    token = create_access_token({"sub": user.email})
    return {"access_token": token, "token_type": "bearer"}

@app.post("/auth/login", response_model=Token)
async def login(user: UserLogin):
    user_data = users_db.get(user.email)
    if not user_data or not verify_password(user.password, user_data["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": user.email})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/auth/me", response_model=User)
async def me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/analyze", response_model=WorkflowGraph)
async def analyze_workflow(
    request: AnalyzeRequest,
    # TODO: Re-enable auth when ready
    # current_user: User = Depends(get_current_user)
):
    # TODO: Re-enable rate limiting when ready
    # check_rate_limit(current_user)

    # Static analysis
    framework = request.framework_hint or static_analyzer.detect_framework(
        request.code,
        request.file_paths[0] if request.file_paths else ""
    )

    # Convert metadata to dict format
    metadata_dicts = [m.dict() for m in request.metadata] if request.metadata else None

    # LLM analysis
    try:
        result = gemini_client.analyze_workflow(request.code, framework, metadata_dicts)
        # Clean markdown if present
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:]
        if result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]

        graph_data = json.loads(result.strip())
        return WorkflowGraph(**graph_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
