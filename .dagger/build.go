package main

import (
	"dagger/lejonet/internal/dagger"
)

// BuildFrontend builds the frontend container from .docker/frontend.dockerfile.
func (m *Lejonet) BuildFrontend(source *dagger.Directory) *dagger.Container {
	return source.
		DockerBuild(dagger.DirectoryDockerBuildOpts{
			Dockerfile: ".docker/frontend.dockerfile",
		})
}
