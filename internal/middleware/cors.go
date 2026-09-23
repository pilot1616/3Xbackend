package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS returns a middleware that echoes the request origin when it appears
// in allowedOrigins, and falls back to "*" when no origins are configured
// (local development). allowCredentials is only sent for whitelisted origins
// because browsers reject it together with a wildcard origin.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	origins := make([]string, 0, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		if len(origins) == 0 {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		} else if containsOrigin(origins, origin) {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Add("Vary", "Origin")
		}

		c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func containsOrigin(origins []string, origin string) bool {
	for _, allowed := range origins {
		if strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}
