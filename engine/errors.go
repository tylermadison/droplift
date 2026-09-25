package engine

import (
	"errors"

	"github.com/aws/smithy-go"
)

// clearMessage turns a storage error into the user message from PRD §7.5 (E1).
// Unknown errors keep the service text, so the user still sees the cause.
func clearMessage(err error, p destTestParams) string {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return err.Error()
	}
	switch apiErr.ErrorCode() {
	case "AccessDenied":
		return p.Name + " cannot write to " + p.Bucket + "."
	case "NoSuchBucket":
		return "The bucket " + p.Bucket + " does not exist."
	case "InvalidAccessKeyId", "SignatureDoesNotMatch":
		return "The access keys for " + p.Name + " are not correct."
	case "RequestTimeTooSkewed":
		return "Your Mac clock is not correct."
	case "ExpiredToken":
		return "Your AWS sign-in expired."
	}
	return err.Error()
}
