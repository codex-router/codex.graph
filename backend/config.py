from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gemini_api_key: str = ""
    litellm_base_url: str = ""
    litellm_api_key: str = ""
    litellm_model: str = ""
    litellm_ssl_verify: bool = False
    litellm_ca_bundle: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
