package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

type ProjectInput struct {
	Name        string `json:"name"`
	Product     string `json:"product"`
	Description string `json:"description"`
	Benefits    string `json:"benefits"`
	Color       string `json:"color"`
	Reference   string `json:"reference"`
}

type AssetPatch struct {
	Title    string `json:"title"`
	Template string `json:"template"`
	Ratio    string `json:"ratio"`
	Prompt   string `json:"prompt"`
}
type TemplateInput struct {
	Name      string `json:"name"`
	Ratio     string `json:"ratio"`
	Direction string `json:"direction"`
}
type PackInput struct {
	Kind             string   `json:"kind"`
	SceneTemplateIDs []string `json:"scene_template_ids"`
	TemplateID       string   `json:"template_id"`
}

var builtInTemplates = []map[string]any{
	{"id": "hero-image", "name": "商品主图", "group": "商品展示", "ratio": "1:1", "direction": "干净背景、完整展示商品轮廓、视觉焦点明确。", "custom": false},
	{"id": "lifestyle-scene", "name": "生活场景", "group": "场景展示", "ratio": "2:3", "direction": "将商品置于真实使用环境，体现尺度、氛围和使用价值。", "custom": false},
	{"id": "detail-macro", "name": "核心细节", "group": "场景展示", "ratio": "2:3", "direction": "特写呈现材质、结构、纹理和标志性细节。", "custom": false},
	{"id": "poster-banner", "name": "卖点海报", "group": "场景展示", "ratio": "2:3", "direction": "突出商品，留出信息排版空间，适用于促销和传播。", "custom": false},
}

func stableID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:16])
}
func newID(kind string) string { return stableID(fmt.Sprintf("%s-%d", kind, time.Now().UnixNano())) }

func (s *Studio) Projects() ([]map[string]any, error) {
	rows, err := s.db.Query("select p.id,p.user_id,p.name,p.product,p.description,p.benefits,p.color,p.reference,p.created_at,count(a.id) from projects p left join assets a on a.project_id=p.id group by p.id order by p.created_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []map[string]any{}
	for rows.Next() {
		var id, uid, name, product, description, benefits, color, reference string
		var created, count int64
		if err := rows.Scan(&id, &uid, &name, &product, &description, &benefits, &color, &reference, &created, &count); err != nil {
			return nil, err
		}
		projects = append(projects, map[string]any{"id": id, "user_id": uid, "name": name, "product": product, "description": description, "benefits": benefits, "color": color, "reference": reference, "created_at": created, "asset_count": count})
	}
	return projects, rows.Err()
}

func (s *Studio) Project(id string) (map[string]any, error) {
	project, err := s.localProject(id)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id,title,template,ratio,prompt,status,file_path,generation_started_at,created_at from assets where project_id=? order by created_at", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := []map[string]any{}
	for rows.Next() {
		var id, title, template, ratio, prompt, status string
		var path sql.NullString
		var started sql.NullInt64
		var created int64
		if err := rows.Scan(&id, &title, &template, &ratio, &prompt, &status, &path, &started, &created); err != nil {
			return nil, err
		}
		versions, err := s.assetVersions(id)
		if err != nil {
			return nil, err
		}
		assets = append(assets, map[string]any{"id": id, "project_id": project["id"], "title": title, "template": template, "ratio": ratio, "prompt": prompt, "status": status, "file_path": nullableString(path), "generation_started_at": nullableInt(started), "created_at": created, "versions": versions})
	}
	project["assets"] = assets
	return project, rows.Err()
}

func (s *Studio) CreateProject(input ProjectInput) (map[string]string, error) {
	if err := validateProjectInput(input); err != nil {
		return nil, err
	}
	id := newID("project")
	_, err := s.execDataWrite("insert into projects(id,user_id,name,product,description,benefits,color,reference,created_at) values(?,?,?,?,?,?,?,?,?)", id, localWorkspaceID, input.Name, input.Product, input.Description, input.Benefits, input.Color, input.Reference, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": id}, nil
}

func (s *Studio) DeleteProject(id string) (map[string]bool, error) {
	if _, err := s.localProject(id); err != nil {
		return nil, err
	}
	done, err := s.beginDataWrite()
	if err != nil {
		return nil, err
	}
	defer done()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("delete from asset_versions where asset_id in (select id from assets where project_id=?)", id); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("delete from assets where project_id=?", id); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("delete from projects where id=?", id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) UpdateAsset(id string, patch AssetPatch) (map[string]bool, error) {
	var owned int
	err := s.db.QueryRow("select count(*) from assets where id=?", id).Scan(&owned)
	if err != nil {
		return nil, err
	}
	if owned == 0 {
		return nil, errors.New("画面不存在")
	}
	if err := validateAssetPatch(patch); err != nil {
		return nil, err
	}
	_, err = s.execDataWrite("update assets set title=case when ?='' then title else ? end,template=case when ?='' then template else ? end,ratio=case when ?='' then ratio else ? end,prompt=case when ?='' then prompt else ? end where id=?", patch.Title, patch.Title, patch.Template, patch.Template, patch.Ratio, patch.Ratio, patch.Prompt, patch.Prompt, id)
	if err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) Templates() ([]map[string]any, error) {
	rows, err := s.db.Query("select id,name,ratio,direction from custom_templates order by created_at desc")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := append([]map[string]any{}, builtInTemplates...)
	for rows.Next() {
		var id, name, ratio, direction string
		if err := rows.Scan(&id, &name, &ratio, &direction); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{"id": id, "name": name, "group": "自定义", "ratio": ratio, "direction": direction, "custom": true})
	}
	return result, rows.Err()
}
func (s *Studio) AddTemplate(input TemplateInput) (map[string]string, error) {
	if err := validateTemplateInput(input); err != nil {
		return nil, err
	}
	id := newID("template")
	_, err := s.execDataWrite("insert into custom_templates values(?,?,?,?,?,?)", id, localWorkspaceID, input.Name, input.Ratio, input.Direction, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": id}, nil
}
func (s *Studio) DeleteTemplate(id string) (map[string]bool, error) {
	result, err := s.execDataWrite("delete from custom_templates where id=?", id)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("模板不存在")
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) LatestCreation() (map[string]any, error) {
	var projectID, title, path string
	var created int64
	err := s.db.QueryRow("select p.id,a.title,av.file_path,av.created_at from asset_versions av join assets a on a.id=av.asset_id join projects p on p.id=a.project_id order by av.created_at desc,av.id desc limit 1").Scan(&projectID, &title, &path, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"creation": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"creation": map[string]any{"project_id": projectID, "title": title, "file_path": path, "created_at": created}}, nil
}

func (s *Studio) CreatePack(projectID string, input PackInput) (map[string]bool, error) {
	project, err := s.localProject(projectID)
	if err != nil {
		return nil, err
	}
	templates, err := s.Templates()
	if err != nil {
		return nil, err
	}
	byID := map[string]map[string]any{}
	for _, item := range templates {
		byID[item["id"].(string)] = item
	}
	type item struct{ code, title, template, ratio, direction string }
	var items []item
	if selected := byID[input.TemplateID]; selected != nil {
		items = []item{{"T1", selected["name"].(string), input.TemplateID, selected["ratio"].(string), selected["direction"].(string)}}
	} else {
		switch input.Kind {
		case "social":
			items = []item{{"S1", "种草主视觉", "lifestyle-scene", "2:3", "A scroll-stopping lifestyle image with the product naturally featured."}, {"S2", "产品细节", "detail-macro", "2:3", "A tactile close-up that highlights craftsmanship and product details."}, {"S3", "品牌海报", "poster-banner", "2:3", "A premium campaign composition with generous copy space."}}
		case "custom":
			items = []item{{"H1", "商品主图", "hero-image", "1:1", "A clear ecommerce hero shot on a clean background, centered and fully visible."}}
		default:
			items = []item{{"H1", "商品主图", "hero-image", "1:1", "A clean hero shot on #FFFFFF, product occupies 38%, with clear price-overlay whitespace."}, {"H2", "核心细节", "detail-macro", "1:1", "A macro close-up of material, texture and construction."}, {"H3", "使用场景", "lifestyle-scene", "1:1", "The product naturally used in a believable everyday setting."}, {"D1", "核心卖点", "poster-banner", "2:3", "A benefit-led product poster with reserved copy space."}}
		}
	}
	done, err := s.beginDataWrite()
	if err != nil {
		return nil, err
	}
	defer done()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("delete from asset_versions where asset_id in (select id from assets where project_id=?)", projectID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("delete from assets where project_id=?", projectID); err != nil {
		return nil, err
	}
	for _, item := range items {
		prompt := makePrompt(project, item.title, item.direction)
		if _, err = tx.Exec("insert into assets(id,project_id,title,template,ratio,prompt,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?)", newID("asset"), projectID, item.code+" · "+item.title, item.template, item.ratio, prompt, "draft", nil, time.Now().Unix()); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) ResetPrompt(id string) (map[string]string, error) {
	var projectID, title, template string
	err := s.db.QueryRow("select a.project_id,a.title,a.template from assets a join projects p on p.id=a.project_id where a.id=?", id).Scan(&projectID, &title, &template)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("画面不存在")
	}
	if err != nil {
		return nil, err
	}
	project, err := s.localProject(projectID)
	if err != nil {
		return nil, err
	}
	direction := "Create a commercially useful composition."
	for _, item := range builtInTemplates {
		if item["id"] == template {
			direction = item["direction"].(string)
		}
	}
	prompt := makePrompt(project, title, direction)
	_, err = s.execDataWrite("update assets set prompt=? where id=?", prompt, id)
	if err != nil {
		return nil, err
	}
	return map[string]string{"prompt": prompt}, nil
}
func makePrompt(project map[string]any, title, direction string) string {
	return fmt.Sprintf("E-commerce commercial image. Purpose: %s. Art direction: %s. Product: %v. Description: %v. Benefits: %v. Campaign Style Lock: brand accent %v, premium commercial lighting, clean composition and conversion focus. Preserve exact product identity from the supplied reference. Leave intentional whitespace. No watermark, unrelated products, fake logo or unreadable extra text.", title, direction, project["product"], project["description"], project["benefits"], project["color"])
}

func (s *Studio) localProject(id string) (map[string]any, error) {
	var pid, uid, name, product, description, benefits, color, reference string
	var created int64
	err := s.db.QueryRow("select id,user_id,name,product,description,benefits,color,reference,created_at from projects where id=?", id).Scan(&pid, &uid, &name, &product, &description, &benefits, &color, &reference, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("项目不存在")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": pid, "user_id": uid, "name": name, "product": product, "description": description, "benefits": benefits, "color": color, "reference": reference, "created_at": created}, nil
}
func (s *Studio) assetVersions(id string) ([]map[string]any, error) {
	rows, err := s.db.Query("select id,asset_id,file_path,created_at from asset_versions where asset_id=? order by created_at desc", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var vid, asset, path string
		var created int64
		if err := rows.Scan(&vid, &asset, &path, &created); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{"id": vid, "asset_id": asset, "file_path": path, "created_at": created})
	}
	return result, rows.Err()
}
func nullableString(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}
func nullableInt(value sql.NullInt64) any {
	if value.Valid {
		return value.Int64
	}
	return nil
}
