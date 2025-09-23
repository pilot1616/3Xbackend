package config

import (
	"fmt"

	"github.com/spf13/viper"
)

func Parse(path string) error {
	viper.SetConfigFile(path)
	if err := viper.ReadInConfig(); err != nil {
		return fmt.Errorf("read config failed : %v", err)
	}
	return nil
}
