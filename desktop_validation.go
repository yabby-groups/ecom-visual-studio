package main

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxProjectNameRunes  = 120
	maxProductRunes      = 200
	maxDescriptionRunes  = 3000
	maxBenefitsRunes     = 3000
	maxColorRunes        = 20
	maxReferenceRunes    = 500
	maxTemplateNameRunes = 80
	maxDirectionRunes    = 1800
	maxAssetTitleRunes   = 120
	maxPromptRunes       = 12000
	maxPathRunes         = 500
	maxInstructionsRunes = 1000
	maxChatMessages      = 12
	maxChatMessageRunes  = 6000
)

func validateRequired(value, label string, maxRunes int) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("请填写%s", label)
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return fmt.Errorf("%s不能超过 %d 个字符", label, maxRunes)
	}
	return nil
}

func validateOptional(value, label string, maxRunes int) error {
	if value != "" && utf8.RuneCountInString(value) > maxRunes {
		return fmt.Errorf("%s不能超过 %d 个字符", label, maxRunes)
	}
	return nil
}

func validateProjectInput(input ProjectInput) error {
	if err := validateRequired(input.Name, "项目名称", maxProjectNameRunes); err != nil {
		return err
	}
	if err := validateRequired(input.Product, "商品名称", maxProductRunes); err != nil {
		return err
	}
	for _, field := range []struct {
		value string
		label string
		max   int
	}{
		{input.Description, "商品描述", maxDescriptionRunes},
		{input.Benefits, "商品卖点", maxBenefitsRunes},
		{input.Color, "品牌色", maxColorRunes},
		{input.Reference, "参考图路径", maxReferenceRunes},
	} {
		if err := validateOptional(field.value, field.label, field.max); err != nil {
			return err
		}
	}
	return nil
}

func validateAssetPatch(patch AssetPatch) error {
	for _, field := range []struct {
		value string
		label string
		max   int
	}{
		{patch.Title, "画面标题", maxAssetTitleRunes},
		{patch.Template, "模板标识", maxTemplateNameRunes},
		{patch.Ratio, "画面比例", 12},
		{patch.Prompt, "画面提示词", maxPromptRunes},
	} {
		if err := validateOptional(field.value, field.label, field.max); err != nil {
			return err
		}
	}
	if patch.Ratio != "" {
		_, err := imageSize(patch.Ratio)
		return err
	}
	return nil
}

func validateTemplateInput(input TemplateInput) error {
	if err := validateRequired(input.Name, "模板名称", maxTemplateNameRunes); err != nil {
		return err
	}
	if err := validateRequired(input.Ratio, "模板比例", 12); err != nil {
		return err
	}
	if _, err := imageSize(input.Ratio); err != nil {
		return err
	}
	return validateRequired(input.Direction, "模板说明", maxDirectionRunes)
}

func validateTryOnInput(input TryOnInput) error {
	if len(input.PersonPaths) == 0 || len(input.GarmentPaths) == 0 || len(input.PersonPaths) > 4 || len(input.GarmentPaths) > 4 {
		return errors.New("人物照片和服装图片最多各添加 4 张，且不能为空")
	}
	if err := validateOptional(input.Instructions, "换装说明", maxInstructionsRunes); err != nil {
		return err
	}
	if err := validateRequired(input.Ratio, "画面比例", 12); err != nil {
		return err
	}
	if _, err := imageSize(input.Ratio); err != nil {
		return err
	}
	if input.GenerationMode != "combined" && input.GenerationMode != "combinations" {
		return errors.New("换装生成模式无效")
	}
	for _, path := range append(append([]string{}, input.PersonPaths...), input.GarmentPaths...) {
		if err := validateRequired(path, "参考图路径", maxPathRunes); err != nil {
			return err
		}
	}
	return nil
}

func validateChatMessages(messages []map[string]string) error {
	if len(messages) == 0 || messages[len(messages)-1]["role"] != "user" {
		return errors.New("请输入消息")
	}
	if len(messages) > maxChatMessages {
		return fmt.Errorf("对话最多保留 %d 条消息", maxChatMessages)
	}
	for _, message := range messages {
		if message["role"] != "user" && message["role"] != "assistant" {
			return errors.New("对话角色无效")
		}
		if err := validateRequired(message["content"], "消息内容", maxChatMessageRunes); err != nil {
			return err
		}
	}
	return nil
}
