package main

import (
	"database/sql"
	"strings"
	"testing"
)

func TestUpdateWorkTitleAcrossLibraryTypes(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into projects(id,user_id,name,product,created_at) values('project-1',?,'旧图片名称','台灯',1)", localWorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into try_on_jobs(id,user_id,person_paths,garment_paths,generation_mode,ratio,status,created_at) values('try-1',?,'[\"uploads/person.png\"]','[\"uploads/shirt.png\"]','combined','1:1','ready',1)", localWorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into video_replica_jobs(id,user_id,source_video_path,task_type,model,duration,resolution,ratio,status,created_at) values('video-1',?,'uploads/source.mp4','auto','seedance-2.0',5,'480p','16:9','ready',1)", localWorkspaceID); err != nil {
		t.Fatal(err)
	}
	for _, input := range []workTitleInput{
		{Kind: "project", ID: "project-1", Title: "  暖光台灯系列  "},
		{Kind: "try-on", ID: "try-1", Title: "秋日通勤穿搭"},
		{Kind: "video", ID: "video-1", Title: "轻盈出行短片"},
	} {
		if _, err := studio.UpdateWorkTitle(input); err != nil {
			t.Fatalf("UpdateWorkTitle(%#v): %v", input, err)
		}
	}
	var projectTitle, tryTitle, videoTitle string
	if err := db.QueryRow("select name from projects where id='project-1'").Scan(&projectTitle); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("select title from try_on_jobs where id='try-1'").Scan(&tryTitle); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("select title from video_replica_jobs where id='video-1'").Scan(&videoTitle); err != nil {
		t.Fatal(err)
	}
	if projectTitle != "暖光台灯系列" || tryTitle != "秋日通勤穿搭" || videoTitle != "轻盈出行短片" {
		t.Fatalf("saved titles = %q, %q, %q", projectTitle, tryTitle, videoTitle)
	}
	if _, err := studio.UpdateWorkTitle(workTitleInput{Kind: "video", ID: "video-1", Title: " "}); err == nil {
		t.Fatal("blank title was accepted")
	}
}

func TestParseWorkTitleSuggestions(t *testing.T) {
	titles, err := parseWorkTitleSuggestions("```json\n{\"titles\":[\"晨光茶具\",\"暖调茶席\",\"周末品茗\"]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(titles) != 3 || titles[1] != "暖调茶席" {
		t.Fatalf("titles = %#v", titles)
	}
	if _, err := parseWorkTitleSuggestions(`{"titles":["重复","重复","第三个"]}`); err == nil {
		t.Fatal("duplicate suggestions were accepted")
	}
	if _, err := parseWorkTitleSuggestions(`{"titles":["一","二"]}`); err == nil {
		t.Fatal("wrong suggestion count was accepted")
	}
	if _, err := parseWorkTitleSuggestions(`{"titles":["` + strings.Repeat("名", maxWorkTitleRunes+1) + `","二","三"]}`); err == nil {
		t.Fatal("oversized title was accepted")
	}
}
