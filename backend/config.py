from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    secret_key: str
    gemini_api_key: str
    free_trial_requests_per_day: int = 10
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    class Config:
        env_file = ".env"

settings = Settings()
