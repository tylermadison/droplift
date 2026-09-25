package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type destTestParams struct {
	Provider  string `json:"provider"`
	Name      string `json:"name"`
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	AccountID string `json:"accountId"`
	Profile   string `json:"profile"`
	Account   string `json:"account"`
}

type testResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

type accessKeys struct {
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

// destTest writes a small object and deletes it again (PRD R1).
func (s *session) destTest(ctx context.Context, p destTestParams) testResult {
	client, err := s.s3Client(ctx, p)
	if err != nil {
		return testResult{Message: err.Error()}
	}
	key := aws.String(".droplift-test/" + randomHex(8))
	if _, err := client.PutObject(ctx, &s3.PutObjectInput{Bucket: &p.Bucket, Key: key, Body: strings.NewReader("droplift")}); err != nil {
		return testResult{Message: clearMessage(err, p)}
	}
	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &p.Bucket, Key: key}); err != nil {
		return testResult{Message: clearMessage(err, p)}
	}
	return testResult{OK: true}
}

func (s *session) s3Client(ctx context.Context, p destTestParams) (*s3.Client, error) {
	if p.Profile != "" {
		// Named profile (keys or SSO) from the user's AWS config: no secret.request (PRD A2).
		cfg, err := config.LoadDefaultConfig(ctx, config.WithSharedConfigProfile(p.Profile))
		if err != nil {
			return nil, err
		}
		return s3.NewFromConfig(cfg, s.providerOptions(p)), nil
	}
	var keys accessKeys
	if err := s.call(ctx, "secret.request", map[string]string{"account": p.Account}, &keys); err != nil {
		return nil, err
	}
	return s3.New(s3.Options{Credentials: credentials.NewStaticCredentialsProvider(keys.AccessKeyID, keys.SecretAccessKey, "")},
		s.providerOptions(p)), nil
}

// providerOptions sets the endpoint and region for the provider (PRD U2 for R2).
func (s *session) providerOptions(p destTestParams) func(*s3.Options) {
	return func(o *s3.Options) {
		if s.opts.HTTPClient != nil {
			o.HTTPClient = s.opts.HTTPClient
		}
		switch p.Provider {
		case "r2":
			o.Region = "auto"
			o.BaseEndpoint = aws.String("https://" + p.AccountID + ".r2.cloudflarestorage.com")
			o.UsePathStyle = true
		default:
			if p.Region != "" {
				o.Region = p.Region
			}
		}
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
