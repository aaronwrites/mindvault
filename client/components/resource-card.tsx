import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Resource } from "@/lib/types";

export function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <Badge variant="outline" className="mb-1 uppercase">{resource.sourceType}</Badge>
        <CardTitle className="text-lg leading-snug">
          <h3>{resource.title}</h3>
        </CardTitle>
        {resource.url && (
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open ${resource.title}`}
              render={<a href={resource.url} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              <ExternalLink />
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex-1">
        <p className="leading-6 text-muted-foreground">
          {resource.summary ?? "No summary is available for this resource yet."}
        </p>
      </CardContent>

      {resource.tags.length > 0 && (
        <CardFooter>
          <ul className="flex flex-wrap gap-2" aria-label="Tags">
            {resource.tags.map((tag) => (
              <li key={tag}><Badge variant="secondary">{tag}</Badge></li>
            ))}
          </ul>
        </CardFooter>
      )}
    </Card>
  );
}
