package main

import (
	"embed"
	"log"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:desktop_assets
var assets embed.FS

func main() {
	studio, err := NewStudio()
	if err != nil {
		log.Fatal(err)
	}

	err = wails.Run(&options.App{
		Title:     "Ecom Visual Studio",
		Width:     1280,
		Height:    800,
		MinWidth:  1100,
		MinHeight: 720,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: http.HandlerFunc(studio.serveFile),
		},
		BackgroundColour: &options.RGBA{R: 250, G: 248, B: 242, A: 1},
		OnStartup:        studio.startup,
		OnShutdown:       studio.shutdown,
		Bind:             []interface{}{studio},
	})
	if err != nil {
		log.Fatal(err)
	}
}
