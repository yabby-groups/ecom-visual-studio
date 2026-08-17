from typing import Optional

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)
    totp_code: str = Field(default="", max_length=32)


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    product: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=3000)
    benefits: str = Field(default="", max_length=3000)
    color: str = Field(default="#A16207", max_length=20)
    reference: str = Field(default="", max_length=500)


class PackInput(BaseModel):
    kind: str = "amazon"
    scene_template_ids: list[str] = Field(default_factory=list)
    template_id: Optional[str] = Field(default=None, max_length=80)


class AssetPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    template: Optional[str] = Field(default=None, max_length=80)
    ratio: Optional[str] = Field(default=None, max_length=12)
    prompt: Optional[str] = Field(default=None, max_length=12000)


class TemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    ratio: str = Field(default="1:1", max_length=12)
    direction: str = Field(min_length=1, max_length=1800)


class ChatInput(BaseModel):
    messages: list[dict[str, str]] = Field(max_length=12)


class AnalyzeInput(BaseModel):
    mode: str
    product: str = ""
    reference: str = ""


class SettingsInput(BaseModel):
    token_id: str
    image_model: str
    text_model: str
    chat_model: str
