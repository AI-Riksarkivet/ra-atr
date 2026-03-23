package main

import (
	"dagger/ra-atr/internal/dagger"
)

// Serve starts the frontend dev server on port 5173.
func (m *RaAtr) Serve(source *dagger.Directory) *dagger.Service {
	return m.buildFrontendDev(source).
		WithExposedPort(5173).
		WithExec([]string{"npx", "vite", "dev", "--host", "0.0.0.0", "--port", "5173"}).
		AsService()
}
